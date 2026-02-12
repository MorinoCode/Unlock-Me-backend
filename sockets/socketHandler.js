import BlindSession from "../models/BlindSession.js";
import BlindQuestion from "../models/BlindQuestion.js";
import Conversation from "../models/Conversation.js";
import mongoose from "mongoose"; // ✅ Critical Fix: For transactions
import redisClient from "../config/redis.js"; // ✅ New: For Redis Queue

import { addToQueue } from "../utils/blindDateService.js";

// ✅ No more local blindQueue array or local locks.
// Redis sharding and atomic updates are handled in blindDateService.




export const handleSocketConnection = (io, socket, userSocketMap) => {
  const userId = socket.handshake.query.userId;

  if (userId && userId !== "undefined") {
    socket.userId = userId;
    socket.join(userId);
    userSocketMap.set(userId, socket.id);
  }


  // Handle join_room event (for userId room joining)
  socket.on("join_room", (userId) => {
    if (!userId) return;
    const roomName = String(userId);
    socket.userId = roomName;
    socket.join(roomName);
    userSocketMap.set(roomName, socket.id);
    console.log(`[Socket] User ${userId} joined room: ${roomName}, socket ID: ${socket.id}`);
  });

  socket.on("join_blind_queue", async (data) => {
    const currentUserId = socket.userId || data.userId;
    if (!currentUserId) {
      socket.emit("error", { message: "User ID is required" });
      return;
    }

    try {
      const normalizedUserId = String(currentUserId);
      socket.userId = normalizedUserId;
      socket.join(normalizedUserId);

      // ✅ Track user country for disconnect cleanup
      socket.userCountry = data.criteria?.location?.country || "World";

      console.log(`[Blind Queue] User ${normalizedUserId} joining Redis-sharded queue (Country: ${socket.userCountry})`);

      // ✅ Use Enterprise Standard Service
      const result = await addToQueue(normalizedUserId, data.criteria);

      if (result.status === "matched") {
        const { session } = result;
        const payload = JSON.parse(JSON.stringify(session));

        console.log(`[Blind Queue] ✅ MATCH FOUND via Redis: ${session.participants[0].name} <-> ${session.participants[1].name}`);

        // Notify both participants in their dedicated rooms
        session.participants.forEach(p => {
            io.to(p._id.toString()).emit("match_found", payload);
        });

      } else if (result.status === "waiting") {
        socket.emit("queue_status", { status: "waiting_for_match" });
      } else if (result.error) {
        socket.emit("error", { message: result.error });
      }
    } catch (err) {
      console.error("[Blind Queue] Join Error:", err);
      socket.emit("error", { message: "Failed to join queue" });
    }
  });

  socket.on("leave_blind_queue", async () => {
    // Migrated to Redis-safe cleanup (handled on disconnect or explicit leave)
    const country = socket.userCountry || "World";
    const QUEUE_KEY = `blind_date:queue:${country.trim().toLowerCase()}`;
    
    const rawQueue = await redisClient.lRange(QUEUE_KEY, 0, -1);
    for (const item of rawQueue) {
        const u = JSON.parse(item);
        if (u.userId.toString() === socket.userId?.toString()) {
            await redisClient.lRem(QUEUE_KEY, 1, item);
            break;
        }
    }
    console.log(`[Blind Queue] User ${socket.userId} left queue`);
  });

  socket.on("confirm_instructions", async ({ sessionId }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;
      const isUser1 = session.participants[0].toString() === socket.userId;
      if (isUser1) session.stageProgress.u1InstructionRead = true;
      else session.stageProgress.u2InstructionRead = true;

      if (
        session.stageProgress.u1InstructionRead &&
        session.stageProgress.u2InstructionRead
      ) {
        session.status = "active";
        session.currentStage = 1;
      }
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate(
        "questions.questionId"
      );
      io.to(session.participants[0].toString()).emit(
        "session_update",
        updatedSession
      );
      io.to(session.participants[1].toString()).emit(
        "session_update",
        updatedSession
      );
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("typing", ({ receiverId, senderId }) => {
    io.to(receiverId).emit("display_typing", { senderId });
  });

  socket.on("stop_typing", ({ receiverId }) => {
    io.to(receiverId).emit("hide_typing");
  });

  socket.on("submit_blind_answer", async ({ sessionId, choiceIndex }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;
      const isUser1 = session.participants[0].toString() === socket.userId;
      const isUser2 = session.participants[1].toString() === socket.userId;
      const currentQ = session.questions[session.currentQuestionIndex];

      if (isUser1 && currentQ.u1Answer === null)
        currentQ.u1Answer = choiceIndex;
      else if (isUser2 && currentQ.u2Answer === null)
        currentQ.u2Answer = choiceIndex;

      if (currentQ.u1Answer !== null && currentQ.u2Answer !== null) {
        const maxIndex = session.questions.length - 1;
        if (session.currentQuestionIndex < maxIndex) {
          session.currentQuestionIndex += 1;
        } else {
          if (session.currentStage === 1)
            session.status = "waiting_for_stage_2";
          else if (session.currentStage === 2)
            session.status = "waiting_for_stage_3";
        }
      }
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate(
        "questions.questionId"
      );
      const roomId = `blind_${sessionId}`;
      io.to(roomId).emit("session_update", updatedSession);
      io.to(session.participants[0].toString()).emit(
        "session_update",
        updatedSession
      );
      io.to(session.participants[1].toString()).emit(
        "session_update",
        updatedSession
      );
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("proceed_to_next_stage", async ({ sessionId }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;
      const isUser1 = session.participants[0].toString() === socket.userId;
      if (isUser1) session.stageProgress.u1ReadyNext = true;
      else session.stageProgress.u2ReadyNext = true;

      if (
        session.stageProgress.u1ReadyNext &&
        session.stageProgress.u2ReadyNext
      ) {
        session.currentStage += 1;
        session.status = "active";
        session.currentQuestionIndex += 1;
        session.stageProgress.u1ReadyNext = false;
        session.stageProgress.u2ReadyNext = false;

        if (session.currentStage === 2) {
          const nextQuestions = await BlindQuestion.aggregate([
            { $match: { stage: 2 } },
            { $sample: { size: 5 } },
          ]);
          const newQs = nextQuestions.map((q) => ({
            questionId: q._id,
            u1Answer: null,
            u2Answer: null,
          }));
          session.questions.push(...newQs);
        }
      }
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate(
        "questions.questionId"
      );
      io.to(session.participants[0].toString()).emit(
        "session_update",
        updatedSession
      );
      io.to(session.participants[1].toString()).emit(
        "session_update",
        updatedSession
      );
    } catch (err) {
      console.error("Proceed Error:", err);
    }
  });

  socket.on("send_blind_message", async ({ sessionId, text }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session || session.status !== "active") return;
      session.messages.push({
        sender: socket.userId,
        text,
        createdAt: new Date(),
      });
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate(
        "questions.questionId"
      );
      io.to(session.participants[0].toString()).emit(
        "session_update",
        updatedSession
      );
      io.to(session.participants[1].toString()).emit(
        "session_update",
        updatedSession
      );
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("submit_reveal_decision", async ({ sessionId, decision }) => {
    // ✅ Critical Fix: Use MongoDB transaction to prevent race conditions
    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const session = await BlindSession.findById(sessionId).session(dbSession);
      if (!session) {
        await dbSession.abortTransaction();
        return;
      }

      // ✅ Critical Fix: Atomic update
      if (session.participants[0].toString() === socket.userId) {
        session.u1RevealDecision = decision;
      } else {
        session.u2RevealDecision = decision;
      }

      const bothDecided =
        session.u1RevealDecision !== "pending" &&
        session.u2RevealDecision !== "pending";

      if (bothDecided) {
        if (
          session.u1RevealDecision === "yes" &&
          session.u2RevealDecision === "yes"
        ) {
          session.status = "completed";

          // ✅ آنلاک چت برای مچ Blind Date (همان منطق handleRevealDecision)
          const [p1, p2] = session.participants;
          let conversation = await Conversation.findOne({
            participants: { $all: [p1, p2] },
          }).session(dbSession);

          if (!conversation) {
            conversation = new Conversation({
              participants: [p1, p2],
              matchType: "blind_date",
              isUnlocked: true,
              status: "active",
              initiator: p1,
            });
          } else {
            conversation.matchType = "blind_date";
            conversation.isUnlocked = true;
            conversation.status = "active";
          }
          await conversation.save({ session: dbSession });
        } else {
          session.status = "cancelled";
        }
      }

      await session.save({ session: dbSession });
      await dbSession.commitTransaction();

      const updatedSession = await BlindSession.findById(sessionId)
        .populate("participants", "name avatar")
        .populate("questions.questionId");
      io.to(session.participants[0].toString()).emit(
        "session_update",
        updatedSession
      );
      io.to(session.participants[1].toString()).emit(
        "session_update",
        updatedSession
      );
    } catch (err) {
      await dbSession.abortTransaction();
      console.error("Submit Reveal Decision Error:", err);
    } finally {
      dbSession.endSession();
    }
  });

  socket.on("disconnect", async () => {
    if (socket.userId) {
      // 1. Remove from Redis Blind Queue (Sharded)
      const country = socket.userCountry || "World";
      const QUEUE_KEY = `blind_date:queue:${country.trim().toLowerCase()}`;
      
      try {
          const rawQueue = await redisClient.lRange(QUEUE_KEY, 0, -1);
          for (const item of rawQueue) {
              const u = JSON.parse(item);
              if (u.userId.toString() === socket.userId?.toString()) {
                  await redisClient.lRem(QUEUE_KEY, 1, item);
                  console.log(`[Socket] 🗑️ User ${socket.userId} removed from Redis ${country} queue on disconnect`);
                  break;
              }
          }
      } catch (err) {
          console.error("[Socket] Disconnect Cleanup Error:", err);
      }

      // 2. Identify and Notify/Cancel Active Blind Sessions
      try {
          const activeSession = await BlindSession.findOne({
              participants: socket.userId,
              status: { $nin: ["completed", "cancelled"] }
          });

          if (activeSession) {
              activeSession.status = "cancelled";
              await activeSession.save();
              
              // Notify the other participant
              const partnerId = activeSession.participants.find(p => p.toString() !== socket.userId);
              if (partnerId) {
                  io.to(partnerId.toString()).emit("session_cancelled", { 
                      reason: "Partner disconnected",
                      sessionId: activeSession._id
                  });
              }
              console.log(`[Socket] 🛑 Active Blind Session ${activeSession._id} cancelled due to disconnect`);
          }
      } catch (err) {
          console.error("[Socket] Session Cleanup Error:", err);
      }

      userSocketMap.delete(socket.userId);
      const roomName = String(socket.userId);
      socket.leave(roomName);
      console.log(`[Socket] Room ${roomName} left by user ${socket.userId}`);
    }
    console.log(`👋 User disconnected: ${socket.userId || socket.id}`);
  });
};
