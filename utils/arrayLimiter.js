/**
 * ✅ Bug Fix: Memory Leak Prevention
 * Limits array sizes to prevent memory issues
 */

const MAX_ARRAY_SIZES = {
  LIKED_USERS: 10000,      // Max 10k liked users
  DISLIKED_USERS: 50000,   // Max 50k disliked users (can be larger)
  POTENTIAL_MATCHES: 1000, // Max 1k potential matches
  MATCHES: 10000,          // Max 10k matches
};

/**
 * Truncate array if it exceeds max size, keeping most recent items
 */
export const limitArraySize = (array, maxSize) => {
  if (!Array.isArray(array)) return array;
  if (array.length <= maxSize) return array;
  
  // Keep the most recent items (last N items)
  return array.slice(-maxSize);
};

/**
 * Clean up user arrays to prevent memory leaks
 */
export const cleanupUserArrays = async (userId) => {
  try {
    const User = (await import("../models/User.js")).default;
    const user = await User.findById(userId);
    
    if (!user) return;
    
    const updates = {};
    
    // Clean up likedUsers
    if (user.likedUsers && user.likedUsers.length > MAX_ARRAY_SIZES.LIKED_USERS) {
      updates.likedUsers = limitArraySize(user.likedUsers, MAX_ARRAY_SIZES.LIKED_USERS);
    }
    
    // Clean up dislikedUsers
    if (user.dislikedUsers && user.dislikedUsers.length > MAX_ARRAY_SIZES.DISLIKED_USERS) {
      updates.dislikedUsers = limitArraySize(user.dislikedUsers, MAX_ARRAY_SIZES.DISLIKED_USERS);
    }
    
    // Clean up potentialMatches
    if (user.potentialMatches && user.potentialMatches.length > MAX_ARRAY_SIZES.POTENTIAL_MATCHES) {
      // Keep top matches (sorted by matchScore)
      const sorted = user.potentialMatches.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
      updates.potentialMatches = sorted.slice(0, MAX_ARRAY_SIZES.POTENTIAL_MATCHES);
    }
    
    // Clean up matches
    if (user.matches && user.matches.length > MAX_ARRAY_SIZES.MATCHES) {
      updates.matches = limitArraySize(user.matches, MAX_ARRAY_SIZES.MATCHES);
    }
    
    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(userId, { $set: updates });
      console.log(`✅ Cleaned up arrays for user ${userId}`);
    }
    
  } catch (error) {
    console.error("Array cleanup error:", error);
  }
};
