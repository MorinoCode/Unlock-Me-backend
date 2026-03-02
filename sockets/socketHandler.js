import BlindSession from "../models/BlindSession.js";
import BlindQuestion from "../models/BlindQuestion.js";
import Conversation from "../models/Conversation.js";
import mongoose from "mongoose"; // ✅ Critical Fix: For transactions

import { addToQueue, leaveQueue } from "../utils/blindDateService.js";

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
    // Migrated to Redis-safe cleanup O(1)
    const country = socket.userCountry || "World";
    await leaveQueue(socket.userId, country);
    console.log(`[Blind Queue] User ${socket.userId} left queue explicitly`);
  });

  socket.on("confirm_instructions", async ({ sessionId }) => {
    try {
      const sessionInfo = await BlindSession.findById(sessionId).select('participants status');
      if (!sessionInfo || sessionInfo.status !== "instructions") return;
      
      const isUser1 = sessionInfo.participants[0].toString() === socket.userId;
      const userKey = isUser1 ? 'u1InstructionRead' : 'u2InstructionRead';

      // Atomic update
      const updatedSession = await BlindSession.findOneAndUpdate(
        { _id: sessionId },
        { $set: { [`stageProgress.${userKey}`]: true } },
        { new: true }
      ).populate("questions.questionId");

      if (updatedSession.stageProgress.u1InstructionRead && updatedSession.stageProgress.u2InstructionRead && updatedSession.status === "instructions") {
         // Atomic transition to prevent double-firing
         const activeSession = await BlindSession.findOneAndUpdate(
            { _id: sessionId, status: "instructions" },
            { $set: { status: "active", currentStage: 1 } },
            { new: true }
         ).populate("questions.questionId");

         if (activeSession) {
             io.to(activeSession.participants[0].toString()).emit("session_update", activeSession);
             io.to(activeSession.participants[1].toString()).emit("session_update", activeSession);
             return;
         }
      }

      // If not transitioning, just broadcast the read status update
      io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
      io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);
    } catch (err) {
      console.error("Confirm Instructions Error:", err);
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
      // Fetch initial state to get current index and check participant
      const sessionInfo = await BlindSession.findById(sessionId).select('participants currentQuestionIndex status currentStage');
      if (!sessionInfo || sessionInfo.status !== "active") return;

      const isUser1 = sessionInfo.participants[0].toString() === socket.userId;
      const isUser2 = sessionInfo.participants[1].toString() === socket.userId;
      if (!isUser1 && !isUser2) return;

      const userKey = isUser1 ? 'u1Answer' : 'u2Answer';
      const questionIndex = sessionInfo.currentQuestionIndex;

      // 1. ATOMIC UPDATE: Set answer only if it is null and we are still on the same question index
      let updatedSession = await BlindSession.findOneAndUpdate(
        { 
          _id: sessionId, 
          currentQuestionIndex: questionIndex, 
          [`questions.${questionIndex}.${userKey}`]: null 
        },
        { 
          $set: { [`questions.${questionIndex}.${userKey}`]: choiceIndex }
        },
        { new: true }
      ).populate("questions.questionId");

      if (!updatedSession) {
         // Race condition caught: Either already answered, or index moved on. Fetch latest to ensure UI sync.
         updatedSession = await BlindSession.findById(sessionId).populate("questions.questionId");
         if (updatedSession) {
            io.to(sessionInfo.participants[0].toString()).emit("session_update", updatedSession);
            io.to(sessionInfo.participants[1].toString()).emit("session_update", updatedSession);
         }
         return;
      }

      // 2. CHECK: After atomic update, check if BOTH users have answered
      const currentQ = updatedSession.questions[questionIndex];
      if (currentQ.u1Answer !== null && currentQ.u2Answer !== null) {
        const maxIndex = updatedSession.questions.length - 1;
        
        let updateQuery = null;
        if (questionIndex < maxIndex) {
          updateQuery = { $inc: { currentQuestionIndex: 1 } };
        } else {
          if (updatedSession.currentStage === 1) {
            updateQuery = { $set: { status: "waiting_for_stage_2" } };
          } else if (updatedSession.currentStage === 2) {
            updateQuery = { $set: { status: "waiting_for_stage_3" } };
          }
        }

        if (updateQuery) {
          // 3. ATOMIC ADVANCE: Only advance if the index hasn't been advanced yet by the other thread
          const finalSession = await BlindSession.findOneAndUpdate(
            { _id: sessionId, currentQuestionIndex: questionIndex },
            updateQuery,
            { new: true }
          ).populate("questions.questionId");

          if (finalSession) {
             updatedSession = finalSession; // Set for broadcast
          }
        }
      }

      // 4. BROADCAST state to users
      const roomId = `blind_${sessionId}`;
      io.to(roomId).emit("session_update", updatedSession);
      io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
      io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);

    } catch (err) {
      console.error("Submit Blind Answer Error:", err);
    }
  });

  socket.on("proceed_to_next_stage", async ({ sessionId }) => {
    try {
      const sessionInfo = await BlindSession.findById(sessionId).select('participants status currentStage');
      if (!sessionInfo || !["active", "waiting_for_stage_2", "waiting_for_stage_3"].includes(sessionInfo.status)) return;

      const isUser1 = sessionInfo.participants[0].toString() === socket.userId;
      const userKey = isUser1 ? 'u1ReadyNext' : 'u2ReadyNext';

      let updatedSession = await BlindSession.findOneAndUpdate(
        { _id: sessionId },
        { $set: { [`stageProgress.${userKey}`]: true } },
        { new: true }
      ).populate("questions.questionId");

      if (updatedSession.stageProgress.u1ReadyNext && updatedSession.stageProgress.u2ReadyNext) {
        
        // Prepare questions if advancing to stage 2
        let updateQuery = { $set: { status: "active", 'stageProgress.u1ReadyNext': false, 'stageProgress.u2ReadyNext': false }, $inc: { currentStage: 1, currentQuestionIndex: 1 } };
        
        if (updatedSession.currentStage === 1) {
          const nextQuestions = await BlindQuestion.aggregate([
            { $match: { stage: 2 } },
            { $sample: { size: 5 } },
          ]);
          const newQs = nextQuestions.map((q) => ({
            questionId: q._id,
            u1Answer: null,
            u2Answer: null,
          }));
          updateQuery.$push = { questions: { $each: newQs } };
        }

        const activeSession = await BlindSession.findOneAndUpdate(
          { _id: sessionId, status: updatedSession.status }, // atomic transition check
          updateQuery,
          { new: true }
        ).populate("questions.questionId");

        if (activeSession) {
          io.to(activeSession.participants[0].toString()).emit("session_update", activeSession);
          io.to(activeSession.participants[1].toString()).emit("session_update", activeSession);
          return;
        }
      }

      // If not transitioning, broadcast the ready status
      io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
      io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);

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
      // 1. Remove from Redis Blind Queue (Sharded) O(1)
      const country = socket.userCountry || "World";
      await leaveQueue(socket.userId, country);

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
