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

    // 🔥 HIGH-SCALE FIX: Fetch current user ONCE to cache DNA/Interests into Redis
    const me = await User.findById(userId).lean();
    if (!me) return { error: "User not found" };

    // 3. Find Best DNA Match using In-Memory Redis data (O(1) DB calls)
    const { match: partner, matchRawString } = await findBestMatch(me, userCriteria, waitingQueue, rawQueue);

    if (partner) {
      // 4. ATOMIC REMOVAL
      const removedCount = await redisClient.lRem(QUEUE_KEY, 1, matchRawString);
      
      if (removedCount === 0) {
        // Match lost to another server/process, fallback to adding self to queue
        return await pushToQueue(me, userCriteria, QUEUE_KEY);
      }

      // 5. Create Session
      const session = await createBlindSession(userId, partner.userId);
      return { status: "matched", session };
    } else {
      // 6. No match found, push self to queue
      return await pushToQueue(me, userCriteria, QUEUE_KEY);
    }
  } catch (err) {
    console.error("BlindDateService Error:", err);
    return { error: "Database or Redis error" };
  }
};

/**
 * Helper to push user to Redis queue with serialized payload for instant matching
 */
const pushToQueue = async (me, criteria, queueKey) => {
  const newUserObj = { 
    userId: me._id.toString(), 
    age: criteria.age, 
    gender: criteria.gender, 
    lookingFor: criteria.lookingFor, 
    city: criteria.location?.city || me.location?.city,       
    country: criteria.location?.country || me.location?.country,
    // 🔥 Cache DNA & location data in Redis to prevent DB lookups!
    dna: me.dna || {},
    interests: me.interests || [],
    location: me.location || { city: "" },
    joinedAt: Date.now() 
  };
  await redisClient.rPush(queueKey, JSON.stringify(newUserObj));
  return { status: "waiting", message: "Waiting for a match..." };
};

/**
 * Finds the BEST match based on Gender, Age, and DNA score entirely in Memory.
 */
const findBestMatch = async (me, criteria, queue, rawQueue) => {
  // 1. Filter candidates by basic criteria (Gender & Age)
  const validCandidates = queue.map((user, index) => ({ user, index }))
    .filter(({ user }) => {
      if (!user || user.userId === me._id.toString()) return false;

      // Gender Reciprocity
      const genderMatch = (criteria.lookingFor === user.gender) && (user.lookingFor === criteria.gender);
      if (!genderMatch) return false;

      // Age Gap (Standard 10 years)
      const ageDiff = Math.abs(user.age - criteria.age);
      return ageDiff <= 10;
    });

  if (validCandidates.length === 0) return { match: null };

  // 2. DNA Priority Matching (Highest Standard) ENTIRELY IN MEMORY
  const scoredCandidates = validCandidates.map(c => {
    // c.user acts as the cached partner doc
    const score = calculateCompatibility(me, c.user);
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
