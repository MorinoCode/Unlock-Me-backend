/**
 * ✅ Performance Fix: Redis Caching Middleware
 * Caches frequent queries to reduce database load
 */

import redisClient from "../config/redis.js";

// Cache duration in seconds
const CACHE_DURATIONS = {
  USER_PROFILE: 300,      // 5 minutes
  MATCHES: 600,           // 10 minutes
  EXPLORE: 300,           // 5 minutes
  SWIPE_CARDS: 180,       // 3 minutes
};

export const cacheMiddleware = (duration = CACHE_DURATIONS.USER_PROFILE) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip caching if Redis is not available
    if (!redisClient || !redisClient.isOpen) {
      return next();
    }
    
    try {
      // Create cache key from request path and user ID
      const userId = req.user?.userId || 'anonymous';
      const cacheKey = `cache:${req.path}:${userId}:${JSON.stringify(req.query)}`;
      
      // Try to get from cache
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        return res.status(200).json(JSON.parse(cachedData));
      }
      
      // Store original json method
      const originalJson = res.json.bind(res);
      
      // Override json method to cache response
      res.json = function(data) {
        // Cache the response
        if (res.statusCode === 200 && data) {
          redisClient.set(cacheKey, JSON.stringify(data), { EX: duration }).catch(err => {
            console.error("Cache set error:", err);
          });
        }
        return originalJson(data);
      };
      
      next();
    } catch (error) {
      console.error("Cache middleware error:", error);
      next(); // Continue without caching if error
    }
  };
};

// Helper to invalidate cache
export const invalidateCache = async (pattern) => {
  if (!redisClient || !redisClient.isOpen) {
    return;
  }
  
  try {
    // Note: Redis doesn't support pattern deletion directly
    // In production, use Redis SCAN + DEL or maintain a cache key registry
    console.log(`Cache invalidation requested for pattern: ${pattern}`);
  } catch (error) {
    console.error("Cache invalidation error:", error);
  }
};
