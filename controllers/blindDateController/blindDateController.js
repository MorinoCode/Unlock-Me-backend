import BlindSession from '../../models/BlindSession.js';
import BlindQuestion from '../../models/BlindQuestion.js';
import User from '../models/User.js';

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

    const session = await BlindSession.findById(sessionId);
    const isUser1 = session.participants[0].toString() === userId.toString();

    if (isUser1) {
      session.revealDecision.u1Reveal = decision;
    } else {
      session.revealDecision.u2Reveal = decision;
    }

    if (session.revealDecision.u1Reveal && session.revealDecision.u2Reveal) {
      session.status = 'completed';
    } else if (decision === false) {
      session.status = 'cancelled';
    }

    await session.save();
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};