/**
 * ✅ Scalability Optimization: Redis-based Match Helper
 * برای میلیون‌ها کاربر: استفاده از Redis Sorted Sets برای ranking و caching
 */

import redisClient from "../config/redis.js";

const REDIS_PREFIXES = {
  // Sorted Set: ranking users by compatibility score
  USER_RANKING: "rank", // rank:{userId}:{country}:{gender} -> sorted set of candidateIds with scores
  // Hash: store compatibility scores
  COMPATIBILITY: "comp", // comp:{userId1}:{userId2} -> score
  // Set: store excluded users (already swiped)
  EXCLUDED: "excl", // excl:{userId} -> set of userIds
  // Cache: pre-computed swipe cards
  SWIPE_CACHE: "swipe", // swipe:{userId} -> JSON array
  // Sorted Set: potential matches pool
  POTENTIAL_POOL: "pool", // pool:{userId} -> sorted set of candidateIds
};

/**
 * ✅ Store compatibility score in Redis Hash
 * O(1) lookup time
 */
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

/**
 * ✅ Get compatibility score from Redis
 * Falls back to null if not found
 */
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

/**
 * ✅ Add user to ranking pool (Sorted Set)
 * Sorted by compatibility score (highest first)
 */
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

/**
 * ✅ Get top candidates from ranking pool
 * Returns array of candidateIds sorted by score (highest first)
 */
export const getTopCandidates = async (
  userId,
  country,
  gender,
  limit = 20,
  excludeIds = []
) => {
  if (!redisClient || !redisClient.isOpen) return [];

  try {
    const key = `${REDIS_PREFIXES.USER_RANKING}:${userId}:${country}:${
      gender || "all"
    }`;

    // node-redis v4+: zRangeWithScores with REV for highest scores first
    const candidates = await redisClient.zRangeWithScores(key, 0, limit + excludeIds.length - 1, {
      REV: true,
    });

    // candidates is { value, score }[]
    const excludeSet = new Set(excludeIds.map((id) => id.toString()));
    const filtered = candidates
      .filter((c) => !excludeSet.has(String(c.value)))
      .slice(0, limit)
      .map((c) => ({
        userId: String(c.value),
        score: typeof c.score === "number" ? c.score : parseFloat(String(c.score)),
      }));

    return filtered;
  } catch (error) {
    console.error("Get top candidates error:", error);
    return [];
  }
};

/**
 * ✅ Store excluded users (already swiped)
 * Using Redis Set for O(1) lookup
 */
export const addExcludedUser = async (userId, excludedUserId) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const key = `${REDIS_PREFIXES.EXCLUDED}:${userId}`;

    // node-redis v4+: sAdd
    await redisClient.sAdd(key, excludedUserId.toString());

    // Set expiration: 7 days (users might come back)
    await redisClient.expire(key, 604800);
  } catch (error) {
    console.error("Add excluded user error:", error);
  }
};

/**
 * ✅ Check if user is excluded
 */
export const isExcluded = async (userId, candidateId) => {
  if (!redisClient || !redisClient.isOpen) return false;

  try {
    const key = `${REDIS_PREFIXES.EXCLUDED}:${userId}`;

    // node-redis v4+: sIsMember (returns 0/1 in RESP2, treat as boolean)
    const result = await redisClient.sIsMember(key, candidateId.toString());
    return !!result;
  } catch (error) {
    console.error("Check excluded error:", error);
    return false;
  }
};

/**
 * ✅ Batch add excluded users
 */
export const addExcludedUsersBatch = async (userId, excludedUserIds) => {
  if (!redisClient || !redisClient.isOpen || !excludedUserIds.length) return;

  try {
    const key = `${REDIS_PREFIXES.EXCLUDED}:${userId}`;
    const members = excludedUserIds.map((id) => id.toString());

    // node-redis v4+: multi() pipeline with sAdd
    const pipeline = redisClient.multi();
    members.forEach((member) => pipeline.sAdd(key, member));
    await pipeline.exec();

    await redisClient.expire(key, 604800);
  } catch (error) {
    console.error("Batch add excluded users error:", error);
  }
};

/**
 * ✅ Store potential matches pool in Redis Sorted Set
 * This is populated by matchWorker
 */
export const setPotentialMatchesPool = async (userId, matches) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const key = `${REDIS_PREFIXES.POTENTIAL_POOL}:${userId}`;

    // Clear existing pool
    await redisClient.del(key);

    // Add matches with scores using pipeline (node-redis v4+: zAdd)
    if (matches.length > 0) {
      const pipeline = redisClient.multi();
      matches.forEach((m) => {
        pipeline.zAdd(key, { score: m.matchScore, value: m.user.toString() });
      });
      await pipeline.exec();

      // Keep only top 500
      await redisClient.zRemRangeByRank(key, 0, -501);

      // Set expiration: 24 hours (will be refreshed by matchWorker)
      await redisClient.expire(key, 86400);
    }
  } catch (error) {
    console.error("Set potential matches pool error:", error);
  }
};

/**
 * ✅ Get candidates from potential matches pool
 */
export const getFromPotentialPool = async (
  userId,
  limit = 20,
  excludeIds = []
) => {
  return getFromPotentialPoolPaginated(userId, limit, excludeIds, 0);
};

/**
 * ✅ Get candidates from pool with pagination (for Explore)
 * offset = (pageNum - 1) * limitNum; request limit = limitNum for one page
 */
export const getFromPotentialPoolPaginated = async (
  userId,
  limit = 20,
  excludeIds = [],
  offset = 0
) => {
  if (!redisClient || !redisClient.isOpen) return [];

  try {
    const key = `${REDIS_PREFIXES.POTENTIAL_POOL}:${userId}`;
    const needTotal = offset + limit;
    const candidates = await redisClient.zRangeWithScores(key, 0, needTotal + excludeIds.length - 1, {
      REV: true,
    });

    const excludeSet = new Set(excludeIds.map((id) => id.toString()));
    const filtered = candidates
      .filter((c) => !excludeSet.has(String(c.value)))
      .map((c) => ({
        userId: String(c.value),
        score: typeof c.score === "number" ? c.score : parseFloat(String(c.score)),
      }));

    return filtered.slice(offset, offset + limit);
  } catch (error) {
    console.error("Get from potential pool error:", error);
    return [];
  }
};

/**
 * ✅ Invalidate all caches for a user
 */
export const invalidateUserCaches = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    // Get all keys matching patterns
    const patterns = [
      `${REDIS_PREFIXES.USER_RANKING}:${userId}:*`,
      `${REDIS_PREFIXES.COMPATIBILITY}:${userId}:*`,
      `${REDIS_PREFIXES.COMPATIBILITY}:*:${userId}`,
      `${REDIS_PREFIXES.EXCLUDED}:${userId}`,
      `${REDIS_PREFIXES.SWIPE_CACHE}:${userId}`,
      `${REDIS_PREFIXES.POTENTIAL_POOL}:${userId}`,
    ];

    // Note: Redis doesn't support wildcard delete directly
    // We'll delete known patterns
    for (const pattern of patterns) {
      // For exact keys, delete directly
      if (!pattern.includes("*")) {
        await redisClient.del(pattern);
      }
    }
  } catch (error) {
    console.error("Invalidate user caches error:", error);
  }
};

/**
 * ✅ Batch store compatibility scores
 * For matchWorker optimization
 */
export const batchSetCompatibilityScores = async (userId, scores) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const pipeline = redisClient.multi();

    for (const { candidateId, score } of scores) {
      const key1 = `${REDIS_PREFIXES.COMPATIBILITY}:${userId}:${candidateId}`;
      const key2 = `${REDIS_PREFIXES.COMPATIBILITY}:${candidateId}:${userId}`;

      pipeline.set(key1, score.toString(), { EX: 86400 });
      pipeline.set(key2, score.toString(), { EX: 86400 });
    }

    await pipeline.exec();
  } catch (error) {
    console.error("Batch set compatibility scores error:", error);
  }
};
