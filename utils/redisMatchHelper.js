import redisClient from "../config/redis.js";


export const REDIS_PREFIXES = {
  // Sorted Set: ranking users by compatibility score
  USER_RANKING: "rank", // rank:{userId}:{country}:{gender} -> sorted set of candidateIds with scores
  // Hash: store compatibility scores
  COMPATIBILITY: "comp", // comp:{userId1}:{userId2} -> score
  // Set: store excluded users (already swiped)
  EXCLUDED: "excl", // excl:{userId} -> set of userIds
  // Cache: pre-computed swipe cards
  SWIPE_CACHE: "swipe", // swipe:{userId} -> JSON array
  // Sorted Set: potential matches pool
  POOL: "pool", // pool:{userId} -> sorted set of candidateIds
  
  // ✅ EXPLORE NEW KEYS
  EXPLORE_FRESH: "explore:fresh", // explore:fresh:{country} -> ZSET (score: createdAt)
  EXPLORE_CITY: "explore:city", // explore:city:{country}:{city} -> SET
  EXPLORE_INTEREST: "explore:interest", // explore:interest:{tag} -> SET
  EXPLORE_GENDER: "explore:gender", // explore:gender:{country}:{gender} -> SET

  // ✅ NEW: HIGH-SCALE SWIPE KEYS
  LIKES: "likes", // likes:{userId} -> SET of targetUserIds
  USAGE_COUNTER: "usage", // usage:{userId}:{YYYY-MM-DD} -> string (inc)
};


/**
 * ✅ Add user to Explore Indices (Sets & Sorted Sets)
 */
export const addToExploreIndex = async (user) => {
  if (!redisClient || !redisClient.isOpen || !user) return;
  try {
    const userId = user._id.toString();
    const country = user.location?.country;
    const city = user.location?.city ? user.location.city.toLowerCase().replace(/\s+/g, '-') : null;
    const gender = user.gender;
    const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();

    if (!country) return;

    const pipeline = redisClient.multi();

    // 1. Fresh Faces (ZSET) - Always add (or update score if needed)
    pipeline.zAdd(`${REDIS_PREFIXES.EXPLORE_FRESH}:${country}`, { score: createdAt, value: userId });

    // 2. City (SET)
    if (city) {
      pipeline.sAdd(`${REDIS_PREFIXES.EXPLORE_CITY}:${country}:${city}`, userId);
    }

    // 3. Gender (SET)
    if (gender) {
      pipeline.sAdd(`${REDIS_PREFIXES.EXPLORE_GENDER}:${country}:${gender}`, userId);
    }

    // 4. Interests (SET)
    if (user.interests && Array.isArray(user.interests)) {
      user.interests.forEach(tag => {
        if (tag) {
             const tagSlug = tag.trim().toLowerCase().replace(/\s+/g, '-');
             pipeline.sAdd(`${REDIS_PREFIXES.EXPLORE_INTEREST}:${tagSlug}`, userId);
        }
      });
    }

    await pipeline.exec();
    // console.log(`✅ Indexed user ${userId} for Explore`);
  } catch (err) {
    console.error("Redis Add Index Error:", err);
  }
};

/**
 * ✅ Remove user from Explore Indices (For updates/deletions)
 * Note: For updates, we usually remove OLD values first. 
 * But since we don't always know OLD values without a DB fetch, 
 * a simpler strategy for City/Gender update is to remove from ALL potential old keys if possible, 
 * or rely on the Worker to have 'oldUser' data if passed.
 * For now, this function assumes we know the user's CURRENT data to remove (e.g. before an update if we fetched it, or after delete).
 */
export const removeFromExploreIndex = async (user) => {
  if (!redisClient || !redisClient.isOpen || !user) return;
  try {
    const userId = user._id.toString();
    const country = user.location?.country;
    const city = user.location?.city ? user.location.city.toLowerCase().replace(/\s+/g, '-') : null;
    const gender = user.gender;

    if (!country) return;

    const pipeline = redisClient.multi();
    
    // Remove from Fresh Faces
    pipeline.zRem(`${REDIS_PREFIXES.EXPLORE_FRESH}:${country}`, userId);

    // Remove from City
    if (city) {
        pipeline.sRem(`${REDIS_PREFIXES.EXPLORE_CITY}:${country}:${city}`, userId);
    }

    // Remove from Gender
    if (gender) {
        pipeline.sRem(`${REDIS_PREFIXES.EXPLORE_GENDER}:${country}:${gender}`, userId);
    }

    // Remove from Interests
    if (user.interests && Array.isArray(user.interests)) {
        user.interests.forEach(tag => {
            if (tag) {
                const tagSlug = tag.trim().toLowerCase().replace(/\s+/g, '-');
                pipeline.sRem(`${REDIS_PREFIXES.EXPLORE_INTEREST}:${tagSlug}`, userId);
            }
        });
    }

    await pipeline.exec();
  } catch (err) {
    console.error("Redis Remove Index Error:", err);
  }
};

export const clearUserExploreIndices = async (user) => {
    // Helper to remove from ALL potential cities/interests if we don't know the exact old ones?
    // Redis doesn't support "Remove ID from ALL sets". 
    // We must rely on accurate tracking or TTLs.
    // For MVP, we rely on `removeFromExploreIndex` being called with the *snapshot* of the user BEFORE update.
    return removeFromExploreIndex(user);
};


// ... Keep existing exports ...
export const setCompatibilityScore = async (userId1, userId2, score) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const key1 = `${REDIS_PREFIXES.COMPATIBILITY}:${userId1}:${userId2}`;
    const key2 = `${REDIS_PREFIXES.COMPATIBILITY}:${userId2}:${userId1}`;

    // Store bidirectional (symmetric)
    await Promise.all([
      redisClient.set(key1, score.toString(), { EX: 86400 }), // 24 hours
      redisClient.set(key2, score.toString(), { EX: 86400 }),
    ]);
  } catch (error) {
    console.error("Set compatibility score error:", error);
  }
};

export const getCompatibilityScore = async (userId1, userId2) => {
  if (!redisClient || !redisClient.isOpen) return null;

  try {
    const key = `${REDIS_PREFIXES.COMPATIBILITY}:${userId1}:${userId2}`;
    const score = await redisClient.get(key);
    return score ? parseFloat(score) : null;
  } catch (error) {
    console.error("Get compatibility score error:", error);
    return null;
  }
};

export const getCompatibilityScoreBatch = async (userId1, targetUserIds) => {
  if (!redisClient || !redisClient.isOpen || !targetUserIds.length) return Array(targetUserIds.length).fill(null);

  try {
    const keys = targetUserIds.map(id => `${REDIS_PREFIXES.COMPATIBILITY}:${userId1}:${id}`);
    const scores = await redisClient.mGet(keys);
    return scores.map(s => (s !== null ? parseFloat(s) : null));
  } catch (error) {
    console.error("Batch Get compatibility score error:", error);
    return Array(targetUserIds.length).fill(null);
  }
};

export const addToRankingPool = async (
  userId,
  country,
  gender,
  candidateId,
  score
) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const key = `${REDIS_PREFIXES.USER_RANKING}:${userId}:${country}:${
      gender || "all"
    }`;

    // node-redis v4+: zAdd(key, { score, value })
    await redisClient.zAdd(key, { score, value: candidateId.toString() });

    // Keep only top 500 candidates per user
    await redisClient.zRemRangeByRank(key, 0, -501);

    // Set expiration: 24 hours
    await redisClient.expire(key, 86400);
  } catch (error) {
    console.error("Add to ranking pool error:", error);
  }
};

export const getTopCandidates = async (
  userId,
  country,
  gender,
  limit = 20,
  excludeIds = []
) => {
    // ... (Existing implementation placeholder if needed, preserving existing code below)
    return [];
};

/**
 * ✅ Add user to Excluded List (Swiped Left/Right)
 */
export const addExcludedUser = async (userId, excludedId) => {
    if (!redisClient || !redisClient.isOpen) return;
    try {
        const key = `${REDIS_PREFIXES.EXCLUDED}:${userId}`;
        // Add to Set
        await redisClient.sAdd(key, excludedId.toString());
        // Optional: Set expiration if we want "temporary" exclusion, but usually swipes are permanent or long-lived in DB.
        // In Redis we might keep them for a session duration or sync with DB.
        // For now, let's keep it without specific expiry or maybe 24h cache.
        await redisClient.expire(key, 86400); 
    } catch (err) {
        console.error("Add Excluded User Error:", err);
    }
};

/**
 * ✅ Get users from Potential Pool (ZSET) with Exclusions
 */
export const getFromPotentialPool = async (userId, limit = 20, excludeIds = []) => {
    if (!redisClient || !redisClient.isOpen) return [];
    try {
        const key = `${REDIS_PREFIXES.POOL}:${userId}`;
        // We want top matches -> ZREVRANGE
        // Since we need to filter excluded users, we might need to fetch more than 'limit'
        // Strategy: Fetch limit * 2, filter in memory, return 'limit'.
        const fetchSize = limit * 3; 
        const candidates = await redisClient.zRange(key, 0, fetchSize - 1, { REV: true });
        
        if (!candidates || candidates.length === 0) return [];

        const excludeSet = new Set(excludeIds.map(id => id.toString()));
        const filtered = candidates.filter(id => !excludeSet.has(id));
        
        return filtered.slice(0, limit);
    } catch (err) {
        console.error("Get Potential Pool Error:", err);
        return [];
    }
};

/**
 * ✅ Get paginated users from a Potential Pool (ZSET) with exclusions
 */
export const getFromPotentialPoolPaginated = async (userId, limit = 20, excludeIds = [], offset = 0) => {
    if (!redisClient || !redisClient.isOpen) return [];
    try {
        const key = `${REDIS_PREFIXES.POOL}:${userId}`;
        
        // Strategy: Since we can't easily filter ZSET by a list of IDs in Redis without temp keys,
        // we fetch a larger chunk and filter in memory.
        const fetchSize = offset + limit + excludeIds.length + 50; 
        const result = await redisClient.zRangeWithScores(key, 0, fetchSize, { REV: true });
        
        if (!result || result.length === 0) return [];

        const excludeSet = new Set(excludeIds.map(id => id.toString()));
        const filtered = result
            .map(item => ({ userId: item.value, score: item.score }))
            .filter(item => !excludeSet.has(item.userId));
        
        return filtered.slice(offset, offset + limit);
    } catch (err) {
        console.error("Get Potential Pool Paginated Error:", err);
        return [];
    }
};


/**
 * ✅ Invalidate User Caches (Pool, Swipe Cache)
 * Called when user profile updates significantly (location, gender, etc).
 */
export const invalidateUserCaches = async (userId) => {
    if (!redisClient || !redisClient.isOpen) return;
    try {
        const pipeline = redisClient.multi();
        
        // Delete Potential Pool
        pipeline.del(`${REDIS_PREFIXES.POOL}:${userId}`);
        
        // Delete Swipe Cache
        pipeline.del(`${REDIS_PREFIXES.SWIPE_CACHE}:${userId}`);

        // We could also delete Rankings if we knew the keys, but they expire in 24h.
        
        await pipeline.exec();
    } catch (err) {
        console.error("Invalidate User Caches Error:", err);
    }
};


/**
 * ✅ Batch Set Compatibility Scores (Pipeline)
 * Stores scores in Redis for fast access.
 */
export const batchSetCompatibilityScores = async (currentUserId, scoresBatch) => {
    if (!redisClient || !redisClient.isOpen) return;
    try {
        const pipeline = redisClient.multi();
        
        scoresBatch.forEach(({ candidateId, score }) => {
            const key1 = `${REDIS_PREFIXES.COMPATIBILITY}:${currentUserId}:${candidateId}`;
            pipeline.set(key1, score.toString(), { EX: 86400 }); // 24h
        });

        await pipeline.exec();
    } catch (err) {
        console.error("Batch Set Compatibility Scores Error:", err);
    }
};

/**
 * ✅ Set Potential Matches Pool (ZSET)
 * Replaces the entire pool for a user with new calculated matches.
 */
export const setPotentialMatchesPool = async (userId, matches) => {
    if (!redisClient || !redisClient.isOpen) return;
    try {
        const key = `${REDIS_PREFIXES.POOL}:${userId}`;
        
        const pipeline = redisClient.multi();
        // Clear old pool
        pipeline.del(key);
        
        // Add new matches
        // matches array objects: { user: candidateId, matchScore: score }
        matches.forEach(match => {
            pipeline.zAdd(key, { score: match.matchScore, value: match.user.toString() });
        });
        
        // Expire after 24h
        pipeline.expire(key, 86400);
        
        await pipeline.exec();
    } catch (err) {
        console.error("Set Potential Matches Pool Error:", err);
    }
};

/**
 * ✅ Phase 1: Add a user to my Like set in Redis
 */
export const addRedisLike = async (userId, targetUserId) => {
    if (!redisClient || !redisClient.isOpen) return;
    try {
        const key = `${REDIS_PREFIXES.LIKES}:${userId}`;
        await redisClient.sAdd(key, targetUserId.toString());
        await redisClient.expire(key, 2592000); // 30 days keep-alive for likes in memory
    } catch (err) {
        console.error("Redis Add Like Error:", err);
    }
};

/**
 * ✅ Phase 1: Check if target user has liked me (Pre-Match Check)
 */
export const checkRedisMatch = async (myId, targetId) => {
    if (!redisClient || !redisClient.isOpen) return false;
    try {
        const targetLikesKey = `${REDIS_PREFIXES.LIKES}:${targetId}`;
        return await redisClient.sIsMember(targetLikesKey, myId.toString());
    } catch (err) {
        console.error("Redis Check Match Error:", err);
        return false;
    }
};

/**
 * ✅ Phase 3: Increment Swipe Counter (Atomic)
 */
export const incrementSwipeCounter = async (userId, type = "swipes") => {
    if (!redisClient || !redisClient.isOpen) return 0;
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `${REDIS_PREFIXES.USAGE_COUNTER}:${userId}:${date}:${type}`;
        const count = await redisClient.incr(key);
        if (count === 1) {
            await redisClient.expire(key, 86400); // 24h
        }
        return count;
    } catch (err) {
        console.error("Redis Increment Counter Error:", err);
        return 0;
    }
};

/**
 * ✅ Phase 3: Get Swipe Counter
 */
export const getSwipeCounter = async (userId, type = "swipes") => {
    if (!redisClient || !redisClient.isOpen) return 0;
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `${REDIS_PREFIXES.USAGE_COUNTER}:${userId}:${date}:${type}`;
        const val = await redisClient.get(key);
        return val ? parseInt(val) : 0;
    } catch (err) {
        console.error("Redis Get Counter Error:", err);
        return 0;
    }
};

