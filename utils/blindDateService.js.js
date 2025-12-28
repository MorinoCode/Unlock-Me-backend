import BlindSession from '../models/BlindSession.js';
import BlindQuestion from '../models/BlindQuestion.js';

let waitingQueue = [];

export const addToQueue = async (userId, userCriteria) => {
  const existingIndex = waitingQueue.findIndex(u => u.userId.toString() === userId.toString());
  if (existingIndex !== -1) return { message: "Already in queue" };

  const partner = findMatch(userId, userCriteria);

  if (partner) {
    waitingQueue = waitingQueue.filter(u => u.userId.toString() !== partner.userId.toString());
    return await createBlindSession(userId, partner.userId);
  } else {
    waitingQueue.push({ userId, ...userCriteria, joinedAt: Date.now() });
    return { message: "Waiting for a match..." };
  }
};

const findMatch = (userId, criteria) => {
  return waitingQueue.find(user => {
    const ageDiff = Math.abs(user.age - criteria.age);
    const isGenderMatch = user.gender === criteria.lookingFor && user.lookingFor === criteria.gender;
    
    return user.userId.toString() !== userId.toString() && 
           ageDiff <= 10 && 
           isGenderMatch;
  });
};

const createBlindSession = async (u1Id, u2Id) => {
  const firstQuestions = await BlindQuestion.aggregate([
    { $match: { stage: 1 } },
    { $sample: { size: 5 } }
  ]);

  const newSession = new BlindSession({
    participants: [u1Id, u2Id],
    status: 'active',
    questions: firstQuestions.map(q => ({
      questionId: q._id,
      u1Answer: null,
      u2Answer: null
    }))
  });

  return await newSession.save();
};