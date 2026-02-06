import User from "../../models/User.js";
import BlindSession from "../../models/BlindSession.js";
import BlindQuestion from "../../models/BlindQuestion.js";
import Conversation from "../../models/Conversation.js"; // ✅ Imported
import { emitNotification } from "../../utils/notificationHelper.js";
import { getBlindDateConfig } from "../../utils/subscriptionRules.js"; // Ensure correct path
import mongoose from "mongoose"; // ✅ Critical Fix: For transactions
import { getMatchesCache, setMatchesCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";

// --- Helper: Check if two dates are the same day ---
const isSameDay = (d1, d2) => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

// ==========================================
// 1. LIMITS & STATUS
// ==========================================

const BLIND_DATE_STATUS_TTL = 90; // seconds

export const getBlindDateStatus = async (req, res) => {
  try {
    const userId = req.user._id;

    const cached = await getMatchesCache(userId, "blind_date_status");
    if (cached) {
      return res.json(cached);
    }

    const user = await User.findById(userId).select("subscription usage");

    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = user.subscription?.plan || "free";
    const config = getBlindDateConfig(plan);

    const usage = user.usage || {};
    let countToday = usage.blindDatesCount || 0;

    const lastDate = usage.lastBlindDateAt
      ? new Date(usage.lastBlindDateAt)
      : null;
    const now = new Date();

    if (lastDate && !isSameDay(now, lastDate)) {
      countToday = 0;
    }

    let isAllowed = true;
    let reason = null; // 'limit_reached' | 'cooldown'
    let nextAvailableTime = null;

    // A. Check Daily Limit
    if (config.limit !== Infinity && countToday >= config.limit) {
      isAllowed = false;
      reason = "limit_reached";
    }

    // B. Check Cooldown (Only if limit not reached)
    if (isAllowed && config.cooldownHours > 0 && lastDate) {
      if (countToday > 0) {
        const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
        const nextTime = new Date(lastDate.getTime() + cooldownMs);

        if (now < nextTime) {
          isAllowed = false;
          reason = "cooldown";
          nextAvailableTime = nextTime;
        }
      }
    }

    const payload = {
      isAllowed,
      reason,
      nextAvailableTime,
      plan,
      remainingToday:
        config.limit === Infinity
          ? "Unlimited"
          : Math.max(0, config.limit - countToday),
    };

    await setMatchesCache(userId, "blind_date_status", payload, BLIND_DATE_STATUS_TTL);

    res.json(payload);
  } catch (err) {
    console.error("Blind Date Status Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const recordBlindDateUsage = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("usage");

    const now = new Date();
    const lastDate = user.usage?.lastBlindDateAt
      ? new Date(user.usage.lastBlindDateAt)
      : null;

    let newCount = (user.usage?.blindDatesCount || 0) + 1;

    if (lastDate && !isSameDay(now, lastDate)) {
      newCount = 1;
    }

    await User.findByIdAndUpdate(userId, {
      $set: {
        "usage.blindDatesCount": newCount,
        "usage.lastBlindDateAt": now,
      },
    });

    await invalidateMatchesCache(userId, "blind_date_status");
    await invalidateMatchesCache(userId, "blind_date_active_session").catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Record Blind Date Usage Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

const ACTIVE_SESSION_CACHE_TTL = 30; // 30 sec

/** GET /api/blind-date/active-session — current user's active blind session (for polling fallback when socket match_found is missed) */
export const getActiveSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const cached = await getMatchesCache(userId, "blind_date_active_session");
    if (cached !== null) return res.json(cached);

    const session = await BlindSession.findOne({
      participants: userId,
      status: { $nin: ["completed", "cancelled"] },
    })
      .populate("questions.questionId")
      .populate("participants", "name avatar")
      .lean();

    const payload = session ? { session: JSON.parse(JSON.stringify(session)) } : { session: null };
    await setMatchesCache(userId, "blind_date_active_session", payload, ACTIVE_SESSION_CACHE_TTL);
    res.json(payload);
  } catch (err) {
    console.error("Get Active Blind Session Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ==========================================
// 2. GAME LOGIC
// ==========================================

export const submitAnswer = async (req, res) => {
  try {
    const { sessionId, choiceIndex } = req.body;
    const userId = req.user._id;

    const session = await BlindSession.findById(sessionId);
    if (!session || session.status === "cancelled") {
      return res.status(404).json({ error: "Session not found" });
    }

    // ✅ Critical Fix: Null check and bounds check to prevent crash
    if (
      !session.questions ||
      !Array.isArray(session.questions) ||
      session.questions.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "Session questions not initialized" });
    }

    if (
      session.currentQuestionIndex < 0 ||
      session.currentQuestionIndex >= session.questions.length
    ) {
      return res.status(400).json({ error: "Invalid question index" });
    }

    const currentQ = session.questions[session.currentQuestionIndex];
    if (!currentQ) {
      return res.status(400).json({ error: "Question not found" });
    }

    const isUser1 = session.participants[0].toString() === userId.toString();

    if (isUser1) {
      currentQ.u1Answer = choiceIndex;
    } else {
      currentQ.u2Answer = choiceIndex;
    }

    await session.save();

    const bothAnswered =
      currentQ.u1Answer !== null && currentQ.u2Answer !== null;

    if (bothAnswered) {
      if (session.currentQuestionIndex < 4) {
        session.currentQuestionIndex += 1;
      } else {
        if (session.currentStage === 1) {
          session.status = "waiting_for_stage_2";
        } else if (session.currentStage === 2) {
          session.status = "waiting_for_stage_3";
        }
      }
      await session.save();
    }

    res.json({
      session,
      bothAnswered,
      yourChoice: choiceIndex,
      partnerChoice: bothAnswered
        ? isUser1
          ? currentQ.u2Answer
          : currentQ.u1Answer
        : null,
    });
  } catch (err) {
    console.error("Submit Answer Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const sendStageMessage = async (req, res) => {
  try {
    const { sessionId, text } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    const session = await BlindSession.findById(sessionId);
    // ✅ Critical Fix: Null check to prevent crash
    const messageCount = (session.messages || []).filter(
      (m) => m.sender && m.sender.toString() === userId.toString()
    ).length;

    if (session.currentStage === 2 && messageCount >= 2) {
      return res
        .status(400)
        .json({ error: "Message limit reached for this stage" });
    }

    if (session.currentStage === 3 && messageCount >= 10) {
      return res
        .status(400)
        .json({ error: "Message limit reached for this stage" });
    }

    // ✅ Critical Fix: Initialize messages array if null
    if (!session.messages) {
      session.messages = [];
    }
    session.messages.push({ sender: userId, text });
    await session.save();

    const partnerId = session.participants.find(
      (p) => p.toString() !== userId.toString()
    );

    await emitNotification(io, partnerId, {
      type: "BLIND_MESSAGE",
      senderId: userId,
      senderName: "Anonymous",
      message: "Sent you a message in Blind Date 🕵️",
      targetId: sessionId,
    });

    res.json(session);
  } catch (err) {
    console.error("Send Stage Message Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const proceedToNextStage = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user._id;

    const session = await BlindSession.findById(sessionId);
    const isUser1 = session.participants[0].toString() === userId.toString();

    if (isUser1) {
      session.stageProgress.u1ReadyNext = true;
    } else {
      session.stageProgress.u2ReadyNext = true;
    }

    if (
      session.stageProgress.u1ReadyNext &&
      session.stageProgress.u2ReadyNext
    ) {
      session.currentStage += 1;
      session.currentQuestionIndex = 0;
      session.stageProgress.u1ReadyNext = false;
      session.stageProgress.u2ReadyNext = false;

      const nextQuestions = await BlindQuestion.aggregate([
        { $match: { stage: session.currentStage } },
        { $sample: { size: 5 } },
      ]);

      session.questions = nextQuestions.map((q) => ({
        questionId: q._id,
        u1Answer: null,
        u2Answer: null,
      }));

      session.status = "active";
    }

    await session.save();
    await invalidateMatchesCache(userId, "blind_date_active_session").catch(() => {});
    const otherUserId = isUser1 ? session.participants[1] : session.participants[0];
    await invalidateMatchesCache(otherUserId.toString(), "blind_date_active_session").catch(() => {});
    res.json(session);
  } catch (err) {
    console.error("Proceed To Next Stage Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const handleRevealDecision = async (req, res) => {
  // ✅ Critical Fix: Use MongoDB transaction to prevent race conditions
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sessionId, decision } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    // ✅ Critical Fix: Use session for atomic read
    const sessionDoc = await BlindSession.findById(sessionId).session(session);
    if (!sessionDoc) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Session not found" });
    }

    const isUser1 = sessionDoc.participants[0].toString() === userId.toString();

    // ✅ Critical Fix: Atomic update
    if (isUser1) {
      sessionDoc.u1RevealDecision = decision;
    } else {
      sessionDoc.u2RevealDecision = decision;
    }

    const bothDecided =
      sessionDoc.u1RevealDecision !== "pending" &&
      sessionDoc.u2RevealDecision !== "pending";

    if (bothDecided) {
      if (
        sessionDoc.u1RevealDecision === "yes" &&
        sessionDoc.u2RevealDecision === "yes"
      ) {
        sessionDoc.status = "completed";

        // ✅✅✅ UNLOCK CHAT FOR BLIND DATE MATCH ✅✅✅
        const [p1, p2] = sessionDoc.participants;

        let conversation = await Conversation.findOne({
          participants: { $all: [p1, p2] },
        }).session(session);

        if (!conversation) {
          conversation = new Conversation({
            participants: [p1, p2],
            matchType: "blind_date",
            isUnlocked: true, // Bypass subscription limits
            status: "active",
          });
        } else {
          // If conversation existed (e.g. previous limits), unlock it now
          conversation.matchType = "blind_date";
          conversation.isUnlocked = true;
          conversation.status = "active";
        }

        await conversation.save({ session });
        // ✅✅✅ END UNLOCK LOGIC ✅✅✅

        sessionDoc.participants.forEach(async (pId) => {
          await emitNotification(io, pId, {
            type: "REVEAL_SUCCESS",
            senderId: userId,
            senderName: "System",
            message:
              "Congratulations! You both decided to reveal. It's a Match! 🔓",
            targetId: conversation._id, // Redirect to chat
          });
        });
      } else {
        sessionDoc.status = "cancelled";
      }
    }

    await sessionDoc.save({ session });
    await session.commitTransaction();
    const [p1, p2] = sessionDoc.participants;
    await invalidateMatchesCache(p1.toString(), "blind_date_active_session").catch(() => {});
    await invalidateMatchesCache(p2.toString(), "blind_date_active_session").catch(() => {});

    res.json(sessionDoc);
  } catch (err) {
    await session.abortTransaction();
    console.error("Handle Reveal Decision Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  } finally {
    session.endSession();
  }
};
