import BlindSession from "../models/BlindSession.js";
import BlindQuestion from "../models/BlindQuestion.js";
import Conversation from "../models/Conversation.js";
import mongoose from "mongoose"; // ✅ Critical Fix: For transactions

let blindQueue = [];
// ✅ Fix 4: Lock mechanism for race condition prevention
let queueLock = false;
const acquireLock = () => {
  if (queueLock) return false;
  queueLock = true;
  return true;
};
const releaseLock = () => {
  queueLock = false;
};

/**
 * Returns a short reason why user1 and user2 don't match (or "MATCH").
 * Used for debug logging when testing blind date.
 */
function getMatchReason(user1, user2) {
  const id1 = String(user1.userId);
  const id2 = String(user2.userId);
  if (id1 === id2) return "same_user";

  const c1 = (user1.criteria.location?.country ?? "").trim().toLowerCase();
  const c2 = (user2.criteria.location?.country ?? "").trim().toLowerCase();
  const countryMatch =
    !c1 || !c2 || c1 === "unknown" || c2 === "unknown" || c1 === c2;
  if (!countryMatch)
    return `country_mismatch(${c1 || "empty"} vs ${c2 || "empty"})`;

  const u1Gender =
    (user1.criteria.gender ?? "").trim().toLowerCase() || "other";
  const u1Looking = (user1.criteria.lookingFor ?? "").trim().toLowerCase();
  const u2Gender =
    (user2.criteria.gender ?? "").trim().toLowerCase() || "other";
  const u2Looking = (user2.criteria.lookingFor ?? "").trim().toLowerCase();

  if (!u1Looking) return "user1_lookingFor_empty";
  if (!u2Looking) return "user2_lookingFor_empty";

  const match1 = u1Looking === u2Gender;
  const match2 = u2Looking === u1Gender;
  if (!match1)
    return `gender_mismatch: user1 lookingFor=${u1Looking} vs user2 gender=${u2Gender}`;
  if (!match2)
    return `gender_mismatch: user2 lookingFor=${u2Looking} vs user1 gender=${u1Gender}`;

  return "MATCH";
}

/**
 * Match two users for Blind Date.
 * App only has Male, Female, Other (no "All").
 * - Different users (userId comparison as string)
 * - Country: same country, or either missing/empty → allow
 * - Gender: each user's lookingFor must equal the other's gender (Male/Female/Other)
 */
const findMatch = (user1) => {
  const id1 = String(user1.userId);
  return blindQueue.find((user2) => {
    const id2 = String(user2.userId);
    if (id1 === id2) return false;

    const c1 = (user1.criteria.location?.country ?? "").trim().toLowerCase();
    const c2 = (user2.criteria.location?.country ?? "").trim().toLowerCase();
    const countryMatch =
      !c1 || !c2 || c1 === "unknown" || c2 === "unknown" || c1 === c2;
    if (!countryMatch) return false;

    const u1Gender =
      (user1.criteria.gender ?? "").trim().toLowerCase() || "other";
    const u1Looking = (user1.criteria.lookingFor ?? "").trim().toLowerCase();
    const u2Gender =
      (user2.criteria.gender ?? "").trim().toLowerCase() || "other";
    const u2Looking = (user2.criteria.lookingFor ?? "").trim().toLowerCase();

    if (!u1Looking || !u2Looking) return false;
    const match1 = u1Looking === u2Gender;
    const match2 = u2Looking === u1Gender;

    return match1 && match2;
  });
};

// ✅ Performance Fix: Cleanup mechanism for blindQueue
const cleanupBlindQueue = (io) => {
  blindQueue = blindQueue.filter((u) => {
    const socket = io.sockets.sockets.get(u.socketId);
    return socket && socket.connected;
  });
};

// Run cleanup every 10 minutes
let cleanupInterval = null;
export const startBlindQueueCleanup = (io) => {
  if (cleanupInterval) return; // Already started

  cleanupInterval = setInterval(() => {
    cleanupBlindQueue(io);
    console.log(`🧹 Cleaned blind queue. Current size: ${blindQueue.length}`);
  }, 10 * 60 * 1000); // 10 minutes
};

export const handleSocketConnection = (io, socket, userSocketMap) => {
  const userId = socket.handshake.query.userId;

  // ✅ Performance Fix: Start cleanup on first connection
  if (!cleanupInterval) {
    startBlindQueueCleanup(io);
  }

  if (userId && userId !== "undefined") {
    socket.userId = userId;
    socket.join(userId);
    userSocketMap.set(userId, socket.id);
  }

  socket.on("join_blind_queue", async (data) => {
    const currentUserId = socket.userId || data.userId;
    if (!currentUserId) {
      socket.emit("error", { message: "User ID is required" });
      return;
    }

    // ✅ Fix 4: Acquire lock to prevent race condition
    if (!acquireLock()) {
      socket.emit("error", { message: "Queue is busy, please try again" });
      return;
    }

    try {
      const normalizedUserId = String(currentUserId);
      // Ensure this socket is in its userId room so it receives match_found (frontend may not send userId in handshake)
      socket.userId = normalizedUserId;
      socket.join(normalizedUserId);

      const currentUser = {
        socketId: socket.id,
        userId: normalizedUserId,
        criteria: data.criteria || {},
      };

      const crit = currentUser.criteria;
      const logCriteria = {
        gender: crit.gender ?? "(empty)",
        lookingFor: crit.lookingFor ?? "(empty)",
        country: crit.location?.country ?? "(empty)",
      };
      console.log(
        "[Blind Queue] User joined:",
        normalizedUserId,
        "| criteria:",
        JSON.stringify(logCriteria)
      );

      // ✅ Fix 4: Check if user already in queue (double-check with lock)
      const exists = blindQueue.find(
        (u) => String(u.userId) === normalizedUserId || u.socketId === socket.id
      );
      if (exists) {
        releaseLock();
        socket.emit("queue_status", { status: "already_in_queue" });
        return;
      }

      if (blindQueue.length > 0) {
        console.log(
          "[Blind Queue]",
          blindQueue.length,
          "user(s) in queue. Checking match for:",
          normalizedUserId
        );
        blindQueue.forEach((u, i) => {
          const c = u.criteria || {};
          const reason = getMatchReason(currentUser, u);
          console.log(
            `  [Blind Queue] vs queue[${i}] userId=${String(u.userId)} gender=${
              c.gender ?? "?"
            } lookingFor=${c.lookingFor ?? "?"} country=${
              c.location?.country ?? "?"
            } => ${reason}`
          );
        });
      }

      const match = findMatch(currentUser);

      if (match) {
        const matchUserId = String(match.userId);
        console.log(
          "[Blind Queue] MATCH:",
          normalizedUserId,
          "<->",
          matchUserId
        );
        // ✅ Fix 4: Remove both users atomically (compare as string)
        blindQueue = blindQueue.filter(
          (u) =>
            String(u.userId) !== matchUserId &&
            String(u.userId) !== normalizedUserId
        );

        try {
          const questionsStage1 = await BlindQuestion.aggregate([
            { $match: { stage: 1 } },
            { $sample: { size: 5 } },
          ]);

          if (!questionsStage1 || questionsStage1.length === 0) {
            throw new Error("No questions found for stage 1");
          }

          const formattedQuestions = questionsStage1.map((q) => ({
            questionId: q._id,
            u1Answer: null,
            u2Answer: null,
          }));

          const newSession = new BlindSession({
            participants: [normalizedUserId, matchUserId],
            status: "instructions",
            currentStage: 1,
            questions: formattedQuestions,
            startTime: new Date(),
          });

          await newSession.save();

          const populatedSession = await BlindSession.findById(newSession._id)
            .populate("questions.questionId")
            .populate("participants", "name avatar")
            .lean();

          if (!populatedSession) {
            throw new Error("Failed to populate session");
          }

          // Ensure JSON-serializable payload for socket (ObjectId/Date → string)
          let payload;
          try {
            payload = JSON.parse(JSON.stringify(populatedSession));
          } catch (e) {
            console.error("[Blind Queue] Payload serialize error:", e);
            throw e;
          }

          const currentSocketId = socket.id;
          const matchSocketId = match.socketId;
          const matchSocketExists = matchSocketId
            ? !!io.sockets.sockets.get(matchSocketId)
            : false;
          console.log(
            "[Blind Queue] Emitting match_found to socketIds:",
            currentSocketId,
            matchSocketId,
            "| match socket still connected:",
            matchSocketExists
          );

          try {
            io.to(currentSocketId).emit("match_found", payload);
            if (matchSocketId)
              io.to(matchSocketId).emit("match_found", payload);
            io.to(normalizedUserId).emit("match_found", payload);
            io.to(matchUserId).emit("match_found", payload);
          } catch (emitErr) {
            console.error("[Blind Queue] Emit error:", emitErr);
          }
        } catch (err) {
          // ✅ Fix 5: Proper error handling - notify both users by socket.id
          console.error("Error creating blind session:", err);
          socket.emit("error", {
            message: "Failed to create blind date session. Please try again.",
            code: "SESSION_CREATION_FAILED",
          });
          if (match.socketId) {
            io.to(match.socketId).emit("error", {
              message: "Failed to create blind date session. Please try again.",
              code: "SESSION_CREATION_FAILED",
            });
          }
          // Put users back in queue
          blindQueue.push(currentUser);
          blindQueue.push({ ...match, userId: matchUserId });
        }
      } else {
        blindQueue.push(currentUser);
        console.log(
          "[Blind Queue] No match. User added to queue. Queue size:",
          blindQueue.length
        );
        socket.emit("queue_status", { status: "waiting_for_match" });
      }
    } finally {
      // ✅ Fix 4: Always release lock
      releaseLock();
    }
  });

  socket.on("leave_blind_queue", () => {
    blindQueue = blindQueue.filter((u) => u.socketId !== socket.id);
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

  socket.on("join_room", (id) => {
    if (id == null) return;
    const roomId = typeof id === "string" ? id : id?.toString?.() ?? String(id);
    if (!socket.userId) {
      socket.userId = roomId;
      socket.join(roomId);
      userSocketMap.set(roomId, socket.id);
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

  socket.on("disconnect", () => {
    // ✅ Fix 9: Better cleanup on disconnect
    if (socket.userId) {
      // Remove from blind queue
      blindQueue = blindQueue.filter(
        (u) => u.socketId !== socket.id && u.userId !== socket.userId
      );
      // Remove from user socket map
      userSocketMap.delete(socket.userId);
      // Leave socket room
      socket.leave(socket.userId);
    } else {
      // Even if userId is not set, remove by socketId
      blindQueue = blindQueue.filter((u) => u.socketId !== socket.id);
    }
    console.log(`👋 User disconnected: ${socket.userId || socket.id}`);
  });
};
