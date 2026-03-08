import BlindSession from "../models/BlindSession.js";
import BlindQuestion from "../models/BlindQuestion.js";
import Conversation from "../models/Conversation.js";
import mongoose from "mongoose";
import redisClient from "../config/redis.js";

import { addToQueue, leaveQueue } from "../utils/blindDateService.js";

export const handleSocketConnection = (io, socket) => {
  const userId = socket.handshake.query.userId;

  // ✅ FIX #5: Support multi-device — store a Set of socketIds per userId
  if (userId && userId !== "undefined") {
    socket.userId = userId;
    socket.join(userId);
    redisClient.setEx(`user:presence:${userId}`, 60, socket.id).catch(() => {});
  }

  socket.on("heartbeat", () => {
    if (socket.userId) {
      redisClient.setEx(`user:presence:${socket.userId}`, 60, socket.id).catch(() => {});
    }
  });

  socket.on("join_room", (userId) => {
    if (!userId) return;
    const roomName = String(userId);
    socket.userId = roomName;
    socket.join(roomName);
    redisClient.setEx(`user:presence:${roomName}`, 60, socket.id).catch(() => {});
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

      socket.userCountry = data.criteria?.location?.country || "World";

      const result = await addToQueue(normalizedUserId, data.criteria);

      if (result.status === "matched") {
        const { session } = result;
        const payload = JSON.parse(JSON.stringify(session));

        session.participants.forEach(p => {
            io.to(p._id.toString()).emit("match_found", payload);
        });

      } else if (result.status === "waiting") {
        socket.emit("queue_status", { status: "waiting_for_match" });
      } else if (result.error) {
        socket.emit("error", { message: result.error });
      }
    } catch (err) { // eslint-disable-line no-unused-vars
      socket.emit("error", { message: "Failed to join queue" });
    }
  });

  socket.on("leave_blind_queue", async () => {
    const country = socket.userCountry || "World";
    await leaveQueue(socket.userId, country);
  });

  socket.on("confirm_instructions", async ({ sessionId }) => {
    try {
      const sessionCheck = await BlindSession.findOne(
        { _id: sessionId, status: "instructions" }
      ).select("participants stageProgress");
      if (!sessionCheck) return;

      const isUser1 = sessionCheck.participants[0].toString() === socket.userId;
      const isUser2 = sessionCheck.participants[1].toString() === socket.userId;
      if (!isUser1 && !isUser2) return;

      const userKey = isUser1 ? "u1InstructionRead" : "u2InstructionRead";
      const otherKey = isUser1 ? "u2InstructionRead" : "u1InstructionRead";
      const otherAlreadyRead = sessionCheck.stageProgress?.[otherKey] === true;

      if (otherAlreadyRead) {
        const activeSession = await BlindSession.findOneAndUpdate(
          { _id: sessionId, status: "instructions" },
          { $set: { [`stageProgress.${userKey}`]: true, status: "active", currentStage: 1 } },
          { new: true }
        ).populate("questions.questionId");

        if (activeSession) {
          io.to(activeSession.participants[0].toString()).emit("session_update", activeSession);
          io.to(activeSession.participants[1].toString()).emit("session_update", activeSession);
        }
        return;
      }

      const updatedSession = await BlindSession.findOneAndUpdate(
        { _id: sessionId, status: "instructions" },
        { $set: { [`stageProgress.${userKey}`]: true } },
        { new: true }
      ).populate("questions.questionId");

      if (updatedSession) {
        io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
        io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);
      }
    } catch {
      // Ignore background errors
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
      const sessionInfo = await BlindSession.findById(sessionId).select('participants currentQuestionIndex status currentStage');
      if (!sessionInfo || sessionInfo.status !== "active") return;

      const isUser1 = sessionInfo.participants[0].toString() === socket.userId;
      const isUser2 = sessionInfo.participants[1].toString() === socket.userId;
      if (!isUser1 && !isUser2) return;

      const userKey = isUser1 ? 'u1Answer' : 'u2Answer';
      const questionIndex = sessionInfo.currentQuestionIndex;

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
         updatedSession = await BlindSession.findById(sessionId).populate("questions.questionId");
         if (updatedSession) {
            io.to(sessionInfo.participants[0].toString()).emit("session_update", updatedSession);
            io.to(sessionInfo.participants[1].toString()).emit("session_update", updatedSession);
         }
         return;
      }

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
          const finalSession = await BlindSession.findOneAndUpdate(
            { _id: sessionId, currentQuestionIndex: questionIndex },
            updateQuery,
            { new: true }
          ).populate("questions.questionId");

          if (finalSession) {
             updatedSession = finalSession; 
          }
        }
      }

      const roomId = `blind_${sessionId}`;
      io.to(roomId).emit("session_update", updatedSession);
      io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
      io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);

    } catch {
      // Ignore background errors
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
          { _id: sessionId, status: updatedSession.status }, 
          updateQuery,
          { new: true }
        ).populate("questions.questionId");

        if (activeSession) {
          io.to(activeSession.participants[0].toString()).emit("session_update", activeSession);
          io.to(activeSession.participants[1].toString()).emit("session_update", activeSession);
          return;
        }
      }

      io.to(updatedSession.participants[0].toString()).emit("session_update", updatedSession);
      io.to(updatedSession.participants[1].toString()).emit("session_update", updatedSession);

    } catch {
      // Ignore background errors
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
    } catch {
      // Ignore background errors
    }
  });

  socket.on("submit_reveal_decision", async ({ sessionId, decision }) => {
    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const session = await BlindSession.findById(sessionId).session(dbSession);
      if (!session) {
        await dbSession.abortTransaction();
        return;
      }

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
    } catch {
      await dbSession.abortTransaction();
    } finally {
      dbSession.endSession();
    }
  });

  socket.on("disconnect", async () => {
    if (socket.userId) {
      const country = socket.userCountry || "World";
      await leaveQueue(socket.userId, country);

      try {
          const activeSession = await BlindSession.findOne({
              participants: socket.userId,
              status: { $nin: ["completed", "cancelled"] }
          });

          if (activeSession) {
              activeSession.status = "cancelled";
              await activeSession.save();
              
              const partnerId = activeSession.participants.find(p => p.toString() !== socket.userId);
              if (partnerId) {
                  io.to(partnerId.toString()).emit("session_cancelled", { 
                      reason: "Partner disconnected",
                      sessionId: activeSession._id
                  });
              }
          }
      } catch {
        // Ignore background errors
      }

      const roomName = String(socket.userId);
      socket.leave(roomName);
    }
  });
};
