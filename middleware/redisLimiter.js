import redisClient from "../config/redis.js";

/**
 * Professional Redis-based Rate Limiter 🛡️
 * @param {string} prefix - Key prefix for Redis (e.g., 'rate_limit:godate:create')
 * @param {number} limit - Max requests allowed
 * @param {number} windowSeconds - Time window in seconds
 */
export const redisRateLimiter = (prefix, limit, windowSeconds) => {
  return async (req, res, next) => {
    try {
      if (!redisClient.isOpen) {
        return next(); // Fallback if Redis is down
      }

      const userId = req.user?._id?.toString() || req.ip;
      const key = `${prefix}:${userId}`;

      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }

      if (current > limit) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: `Slow down! You can only do this ${limit} times every ${windowSeconds} seconds.`,
        });
      }

      next();
    } catch (err) {
      console.error("Rate Limiter Error:", err);
      next(); // Don't block users if limiter fails
    }
  };
};
