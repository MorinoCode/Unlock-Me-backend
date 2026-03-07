import BlindSession from '../models/BlindSession.js';
import BlindQuestion from '../models/BlindQuestion.js';
import redisClient from '../config/redis.js';
import User from '../models/User.js';
import { calculateCompatibility } from './matchUtils.js';

// ✅ Sharded Keys for ZSET (Queue) and HASH (Payloads)
const getQueueZsetKey = (country) => `blind_date:queue:zset:${(country || 'World').trim().toLowerCase()}`;
const getQueueHashKey = (country) => `blind_date:queue:hash:${(country || 'World').trim().toLowerCase()}`;

/**
 * Add a user to the sharded Redis queue and try to find a match.
 * Uses a DNA-priority matching logic for "Highest Standard".
 */
export const addToQueue = async (userId, userCriteria) => {
  if (!userId) return { error: "User ID is required" };

  const country = userCriteria.location?.country || 'World';
  const ZSET_KEY = getQueueZsetKey(country);
  const HASH_KEY = getQueueHashKey(country);

  try {
    // 1. Fetch current user ONCE to cache DNA/Interests into Redis
    const me = await User.findById(userId).lean();
    if (!me) return { error: "User not found" };

    const userIdStr = userId.toString();

    // 2. Prevent duplicate entries using O(1) Hash check
    const isAlreadyQueued = await redisClient.hExists(HASH_KEY, userIdStr);
    if (isAlreadyQueued) {
      return { status: "waiting", message: "Already in queue" };
    }

    // 3. Fetch Top 150 oldest waiting users from ZSET (O(log(N) + M) instead of O(N))
    const oldestWaitingIds = await redisClient.zRange(ZSET_KEY, 0, 150);
    
    // Filter out self if somehow stuck
    const candidateIds = oldestWaitingIds.filter(id => id !== userIdStr);

    let waitingQueue = [];
    if (candidateIds.length > 0) {
      // 4. Fetch their payloads from Hash Map (O(M))
      const rawPayloads = await redisClient.hmGet(HASH_KEY, candidateIds);
      waitingQueue = rawPayloads.filter(p => p).map(p => JSON.parse(p));
    }

    // 5. Find Best DNA Match using In-Memory data (O(1) DB calls)
    const { match: partner } = await findBestMatch(me, userCriteria, waitingQueue);

    if (partner) {
      // 6. ATOMIC REMOVAL of partner
      const removedCount = await redisClient.zRem(ZSET_KEY, partner.userId);
      
      if (removedCount === 0) {
        // Match lost to another server/process, fallback to adding self to queue
        return await pushToQueue(me, userCriteria, ZSET_KEY, HASH_KEY);
      }

      // Partner successfully locked. Clean up their hash data
      await redisClient.hDel(HASH_KEY, partner.userId);

      // 7. Create Session
      const session = await createBlindSession(userId, partner.userId);
      return { status: "matched", session };
    } else {
      // 8. No match found, push self to queue
      return await pushToQueue(me, userCriteria, ZSET_KEY, HASH_KEY);
    }
  } catch (err) {
    console.error("BlindDateService Error:", err);
    return { error: "Database or Redis error" };
  }
};

/**
 * Helper to push user to Redis ZSET and HASH for instant matching (O(1))
 */
const pushToQueue = async (me, criteria, zsetKey, hashKey) => {
  const userIdStr = me._id.toString();
  const newUserObj = { 
    userId: userIdStr, 
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
  
  // O(1) Insertion
  await redisClient.hSet(hashKey, userIdStr, JSON.stringify(newUserObj));
  await redisClient.zAdd(zsetKey, { score: Date.now(), value: userIdStr });
  
  return { status: "waiting", message: "Waiting for a match..." };
};

/**
 * Instantly removes a user from the queue (Disconnect/Cancel) O(1)
 */
export const leaveQueue = async (userId, country) => {
  if (!userId) return;
  const ZSET_KEY = getQueueZsetKey(country);
  const HASH_KEY = getQueueHashKey(country);
  
  try {
    const userIdStr = userId.toString();
    await redisClient.zRem(ZSET_KEY, userIdStr);
    await redisClient.hDel(HASH_KEY, userIdStr);
    console.log(`[Blind Queue] Removed user ${userIdStr} from Redis ZSET/HASH (${country})`);
  } catch (err) {
    console.error("BlindDateService leaveQueue Error:", err);
  }
};

/**
 * Finds the BEST match based on Gender, Age, and DNA score entirely in Memory.
 */
const findBestMatch = async (me, criteria, queue) => {
  // 1. Filter candidates by basic criteria (Gender & Age)
  const validCandidates = queue.map((user) => ({ user }))
    .filter(({ user }) => {
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
    return { match: best.user };
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
