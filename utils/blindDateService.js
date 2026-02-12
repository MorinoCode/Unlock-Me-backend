import BlindSession from '../models/BlindSession.js';
import BlindQuestion from '../models/BlindQuestion.js';
import redisClient from '../config/redis.js';
import User from '../models/User.js';
import { calculateCompatibility } from './matchUtils.js';

// ✅ Sharded Queue Keys
const getQueueKey = (country) => `blind_date:queue:${(country || 'World').trim().toLowerCase()}`;

/**
 * Add a user to the sharded Redis queue and try to find a match.
 * Uses a DNA-priority matching logic for "Highest Standard".
 */
export const addToQueue = async (userId, userCriteria) => {
  if (!userId) return { error: "User ID is required" };

  const country = userCriteria.location?.country || 'World';
  const QUEUE_KEY = getQueueKey(country);

  try {
    // 1. Fetch the sharded queue from Redis
    const rawQueue = await redisClient.lRange(QUEUE_KEY, 0, -1);
    const waitingQueue = rawQueue.map(item => JSON.parse(item));

    // 2. Prevent duplicate entries
    const isAlreadyQueued = waitingQueue.some(u => u.userId.toString() === userId.toString());
    if (isAlreadyQueued) {
      return { status: "waiting", message: "Already in queue" };
    }

    // 3. Find Best DNA Match in the Shard
    const { match: partner, matchRawString } = await findBestMatch(userId, userCriteria, waitingQueue, rawQueue);

    if (partner) {
      // 4. ATOMIC REMOVAL (Lua script alternative for node-redis v4)
      // We use lRem with the exact JSON string to ensure we remove the correct user
      const removedCount = await redisClient.lRem(QUEUE_KEY, 1, matchRawString);
      
      // If someone else took the match first, they'll have removed it (removedCount = 0)
      if (removedCount === 0) {
        // Match lost to another server/process, fallback to adding self to queue
        return await pushToQueue(userId, userCriteria, QUEUE_KEY);
      }

      // 5. Create Session
      const session = await createBlindSession(userId, partner.userId);
      return { status: "matched", session };
    } else {
      // 6. No match found, push self to queue
      return await pushToQueue(userId, userCriteria, QUEUE_KEY);
    }
  } catch (err) {
    console.error("BlindDateService Error:", err);
    return { error: "Database or Redis error" };
  }
};

/**
 * Helper to push user to Redis queue
 */
const pushToQueue = async (userId, criteria, queueKey) => {
  const newUserObj = { 
    userId: userId.toString(), 
    age: criteria.age, 
    gender: criteria.gender, 
    lookingFor: criteria.lookingFor, 
    city: criteria.location?.city,       
    country: criteria.location?.country, 
    joinedAt: Date.now() 
  };
  await redisClient.rPush(queueKey, JSON.stringify(newUserObj));
  return { status: "waiting", message: "Waiting for a match..." };
};

/**
 * Finds the BEST match based on Gender, Age, and DNA score.
 */
const findBestMatch = async (userId, criteria, queue, rawQueue) => {
  // 1. Filter candidates by basic criteria (Gender & Age)
  const validCandidates = queue.map((user, index) => ({ user, index }))
    .filter(({ user }) => {
      if (!user || user.userId === userId.toString()) return false;

      // Gender Reciprocity
      const genderMatch = (criteria.lookingFor === user.gender) && (user.lookingFor === criteria.gender);
      if (!genderMatch) return false;

      // Age Gap (Standard 10 years)
      const ageDiff = Math.abs(user.age - criteria.age);
      return ageDiff <= 10;
    });

  if (validCandidates.length === 0) return { match: null };

  // 2. DNA Priority Matching (Highest Standard)
  // We fetch User objects for candidates to calculate real DNA compatibility
  const candidateIds = validCandidates.map(c => c.user.userId);
  const [me, partners] = await Promise.all([
    User.findById(userId).lean(),
    User.find({ _id: { $in: candidateIds } }).lean()
  ]);

  if (!me) return { match: null };

  // Calculate scores and sort
  const scoredCandidates = validCandidates.map(c => {
    const partnerDoc = partners.find(p => p._id.toString() === c.user.userId);
    const score = partnerDoc ? calculateCompatibility(me, partnerDoc) : 0;
    return { ...c, score };
  });

  // Sort by Score (Primary) and joinedAt (Secondary for fairness)
  scoredCandidates.sort((a, b) => b.score - a.score || a.user.joinedAt - b.user.joinedAt);

  // Pick the best match
  const best = scoredCandidates[0];
  
  if (best) {
    return { match: best.user, matchRawString: rawQueue[best.index] };
  }

  return { match: null };
};

const createBlindSession = async (u1Id, u2Id) => {
  const firstQuestions = await BlindQuestion.aggregate([
    { $match: { stage: 1 } },
    { $sample: { size: 5 } }
  ]);

  const newSession = new BlindSession({
    participants: [u1Id, u2Id],
    status: 'instructions',
    currentStage: 1,
    currentQuestionIndex: 0,
    questions: firstQuestions.map(q => ({
      questionId: q._id,
      u1Answer: null,
      u2Answer: null
    }))
  });

  const savedSession = await newSession.save();
  return await BlindSession.findById(savedSession._id)
    .populate('questions.questionId')
    .populate('participants', 'name avatar');
};