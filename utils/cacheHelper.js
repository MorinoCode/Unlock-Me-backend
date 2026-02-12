/**
 * ✅ Performance Fix: Cache Helper Functions
 * Utility functions for caching user data and matches
 */

import redisClient from "../config/redis.js";

const CACHE_PREFIXES = {
  USER: "user",
  MATCHES: "matches",
  EXPLORE: "explore",
  SWIPE: "swipe",
  APP: "app",
};

/** Global app-level cache (e.g. locations, subscription plans). */
export const getAppCache = async (key) => {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    const cached = await redisClient.get(`${CACHE_PREFIXES.APP}:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Get app cache error:", error);
    return null;
  }
};

export const setAppCache = async (key, data, ttl = 3600) => {
  if (!redisClient || !redisClient.isOpen) return;
  try {
    await redisClient.set(
      `${CACHE_PREFIXES.APP}:${key}`,
      JSON.stringify(data),
      { EX: ttl }
    );
  } catch (error) {
    console.error("Set app cache error:", error);
  }
};

export const getUserCache = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return null;

  try {
    const cached = await redisClient.get(`${CACHE_PREFIXES.USER}:${userId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Get user cache error:", error);
    return null;
  }
};

export const setUserCache = async (userId, userData, ttl = 300) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    await redisClient.set(
      `${CACHE_PREFIXES.USER}:${userId}`,
      JSON.stringify(userData),
      { EX: ttl }
    );
  } catch (error) {
    console.error("Set user cache error:", error);
  }
};

export const getMatchesCache = async (userId, type) => {
  if (!redisClient || !redisClient.isOpen) return null;

  try {
    const cached = await redisClient.get(
      `${CACHE_PREFIXES.MATCHES}:${userId}:${type}`
    );
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Get matches cache error:", error);
    return null;
  }
};

export const setMatchesCache = async (userId, type, matchesData, ttl = 600) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    await redisClient.set(
      `${CACHE_PREFIXES.MATCHES}:${userId}:${type}`,
      JSON.stringify(matchesData),
      { EX: ttl }
    );
  } catch (error) {
    console.error("Set matches cache error:", error);
  }
};

export const invalidateUserCache = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    await redisClient.del(`${CACHE_PREFIXES.USER}:${userId}`);
    await invalidateGoDateCacheForUser(userId);
  } catch (error) {
    console.error("Invalidate user cache error:", error);
  }
};

/**
 * Invalidate matches cache for a user and type (e.g. "swipe", "explore_overview_1").
 * Call after swipe action so next getSwipeCards returns fresh cards.
 */
export const invalidateMatchesCache = async (userId, type) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    await redisClient.del(`${CACHE_PREFIXES.MATCHES}:${userId}:${type}`);
  } catch (error) {
    console.error("Invalidate matches cache error:", error);
  }
};

/**
 * Invalidate all feed caches for a user (Global Feed & My Posts).
 * Uses SCAN/KEYS pattern matching to find `matches:${userId}:posts_*`.
 */
export const invalidateFeedCache = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return;

  try {
    const pattern = `${CACHE_PREFIXES.MATCHES}:${userId}:posts_*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.error("Invalidate feed cache error:", error);
  }
};

/**
 * Invalidate all explore caches for a user (all categories and pages).
 * Call when user updates location, interests, or preferences.
 */
export const invalidateExploreCache = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return;
  if (typeof redisClient.keys !== "function") return;

  try {
    const pattern = `${CACHE_PREFIXES.MATCHES}:${userId}:explore_*`;
    const keys = await redisClient.keys(pattern);
    if (Array.isArray(keys) && keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (error) {
    console.error("Invalidate explore cache error:", error);
  }
};

/**
 * Invalidate Go Date list cache for one or more users (e.g. after Apply/Withdraw/Accept/Cancel).
 * Uses KEYS for pattern match; safe when key count per user is small.
 */
export const invalidateGoDateCacheForUser = async (userId) => {
  if (!redisClient || !redisClient.isOpen) return;
  if (typeof redisClient.keys !== "function") return;
  try {
    const pattern = `${CACHE_PREFIXES.MATCHES}:${userId}:go_dates*`;
    const keys = await redisClient.keys(pattern);
    if (Array.isArray(keys) && keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (error) {
    console.error("Invalidate go-date cache error:", error);
  }
};

export const invalidateGoDateCacheForUsers = async (userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  for (const id of userIds) {
    await invalidateGoDateCacheForUser(id);
  }
};
