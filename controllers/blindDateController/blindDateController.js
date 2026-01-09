import User from '../../models/User.js';
import BlindSession from '../../models/BlindSession.js';
import BlindQuestion from '../../models/BlindQuestion.js';
import { emitNotification } from '../../utils/notificationHelper.js';
import { getBlindDateConfig } from '../../utils/matchUtils.js';

// --- Helper: Check if two dates are the same day ---
const isSameDay = (d1, d2) => {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

// ==========================================
// 1. LIMITS & STATUS (FIXED FIELD NAMES)
// ==========================================

export const getBlindDateStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('subscription usage');

    if (!user) return res.status(404).json({ message: "User not found" });

    const plan = user.subscription?.plan || 'free';
    const config = getBlindDateConfig(plan); 

    const usage = user.usage || {};
    let countToday = usage.blindDatesCount || 0;
    
    // ✅ FIX: استفاده از lastBlindDateAt (مطابق دیتابیس شما)
    const lastDate = usage.lastBlindDateAt ? new Date(usage.lastBlindDateAt) : null;
    const now = new Date();

    // ریست هوشمند: اگر روز عوض شده، کانتتر را ۰ فرض کن
    if (lastDate && !isSameDay(now, lastDate)) {
        countToday = 0;
    }

    let isAllowed = true;
    let reason = null; // 'limit_reached' | 'cooldown'
    let nextAvailableTime = null;

    // A. Check Daily Limit
    if (config.limit !== Infinity && countToday >= config.limit) {
      isAllowed = false;
      reason = 'limit_reached';
    }

    // B. Check Cooldown (Only if limit not reached)
    if (isAllowed && config.cooldownHours > 0 && lastDate) {
      if (countToday > 0) { // فقط اگر امروز بازی کرده باشد کول‌دان داریم
          const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
          const nextTime = new Date(lastDate.getTime() + cooldownMs);

          if (now < nextTime) {
            isAllowed = false;
            reason = 'cooldown';
            nextAvailableTime = nextTime;
          }
      }
    }

    res.json({
      isAllowed,
      reason,
      nextAvailableTime,
      plan,
      remainingToday: config.limit === Infinity ? 'Unlimited' : Math.max(0, config.limit - countToday)
    });

  } catch (err) {
    console.error("Blind Date Status Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const recordBlindDateUsage = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId).select('usage');
        
        const now = new Date();
        // ✅ FIX: استفاده از lastBlindDateAt
        const lastDate = user.usage?.lastBlindDateAt ? new Date(user.usage.lastBlindDateAt) : null;
        
        let newCount = (user.usage?.blindDatesCount || 0) + 1;

        // اگر روز عوض شده، از ۱ شروع کن
        if (lastDate && !isSameDay(now, lastDate)) {
            newCount = 1;
        }

        await User.findByIdAndUpdate(userId, {
            $set: { 
                "usage.blindDatesCount": newCount,
                "usage.lastBlindDateAt": now // ✅ FIX: ثبت تاریخ در فیلد درست
            }
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. GAME LOGIC (EXISTING)
// ==========================================

export const submitAnswer = async (req, res) => {
  try {
    const { sessionId, choiceIndex } = req.body;
    const userId = req.user._id;

    const session = await BlindSession.findById(sessionId);
    if (!session || session.status === 'cancelled') {
      return res.status(404).json({ error: "Session not found" });
    }

    const currentQ = session.questions[session.currentQuestionIndex];
    const isUser1 = session.participants[0].toString() === userId.toString();

    if (isUser1) {
      currentQ.u1Answer = choiceIndex;
    } else {
      currentQ.u2Answer = choiceIndex;
    }

    await session.save();

    const bothAnswered = currentQ.u1Answer !== null && currentQ.u2Answer !== null;

    if (bothAnswered) {
      if (session.currentQuestionIndex < 4) {
        session.currentQuestionIndex += 1;
      } else {
        if (session.currentStage === 1) {
          session.status = 'waiting_for_stage_2';
        } else if (session.currentStage === 2) {
          session.status = 'waiting_for_stage_3';
        }
      }
      await session.save();
    }

    res.json({
      session,
      bothAnswered,
      yourChoice: choiceIndex,
      partnerChoice: bothAnswered ? (isUser1 ? currentQ.u2Answer : currentQ.u1Answer) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const sendStageMessage = async (req, res) => {
  try {
    const { sessionId, text } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    const session = await BlindSession.findById(sessionId);
    const messageCount = session.messages.filter(m => m.sender.toString() === userId.toString()).length;

    if (session.currentStage === 2 && messageCount >= 2) {
      return res.status(400).json({ error: "Message limit reached for this stage" });
    }

    if (session.currentStage === 3 && messageCount >= 10) {
      return res.status(400).json({ error: "Message limit reached for this stage" });
    }

    session.messages.push({ sender: userId, text });
    await session.save();

    const partnerId = session.participants.find(p => p.toString() !== userId.toString());
    
    await emitNotification(io, partnerId, {
      type: "BLIND_MESSAGE",
      senderId: userId, 
      senderName: "Anonymous",
      message: "Sent you a message in Blind Date 🕵️",
      targetId: sessionId
    });

    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    if (session.stageProgress.u1ReadyNext && session.stageProgress.u2ReadyNext) {
      session.currentStage += 1;
      session.currentQuestionIndex = 0;
      session.stageProgress.u1ReadyNext = false;
      session.stageProgress.u2ReadyNext = false;

      const nextQuestions = await BlindQuestion.aggregate([
        { $match: { stage: session.currentStage } },
        { $sample: { size: 5 } }
      ]);

      session.questions = nextQuestions.map(q => ({
        questionId: q._id,
        u1Answer: null,
        u2Answer: null
      }));

      session.status = 'active';
    }

    await session.save();
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleRevealDecision = async (req, res) => {
  try {
    const { sessionId, decision } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    const session = await BlindSession.findById(sessionId);
    const isUser1 = session.participants[0].toString() === userId.toString();

    if (isUser1) {
      session.revealDecision.u1Reveal = decision;
    } else {
      session.revealDecision.u2Reveal = decision;
    }

    if (session.revealDecision.u1Reveal && session.revealDecision.u2Reveal) {
      session.status = 'completed';
      
      session.participants.forEach(async (pId) => {
        await emitNotification(io, pId, {
          type: "REVEAL_SUCCESS",
          senderId: userId,
          senderName: "System",
          message: "Congratulations! You both decided to reveal. It's a Match! 🔓",
          targetId: sessionId
        });
      });

    } else if (decision === false) {
      session.status = 'cancelled';
    }

    await session.save();
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};