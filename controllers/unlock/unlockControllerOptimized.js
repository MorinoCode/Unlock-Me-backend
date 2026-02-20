/**
 * ✅ Scalability Optimization: Optimized unlock Controller
 * برای میلیون‌ها کاربر با استفاده از Redis
 */

import User from "../../models/User.js";
import {
} from "../../utils/matchUtils.js";
import { emitNotification } from "../../utils/notificationHelper.js";
import {
  getunlockLimit,
  getSuperLikeLimit,
} from "../../utils/subscriptionRules.js";
import {
  getMatchesCache,
  setMatchesCache,
} from "../../utils/cacheHelper.js";
import {
  addExcludedUser,
} from "../../utils/redisMatchHelper.js";
import redisClient from "../../config/redis.js";


/**
 * ✅ Optimized: Get unlock Cards with Redis
 * Strategy:
 * 1. Check Redis cache first (5 minutes)
 * 2. Try Redis ranking pool (pre-computed top candidates)
 * 3. Fallback to DB with Redis compatibility scores
 */
export const getunlockCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;

    // ✅ Log: Confirm optimized controller is being used
    if (process.env.NODE_ENV !== "production") {
      console.log("🚀 Using Optimized unlock Controller with Redis");
    }

    // ✅ Step 1: Get user data FIRST (Required for smart cache filtering)
    const me = await User.findById(currentUserId)
      .select(
        "location interests lookingFor potentialMatches likedUsers dislikedUsers superLikedUsers blockedUsers blockedBy dna birthday gender subscription"
      )
      .lean();

    if (!me) return res.status(404).json({ message: "User not found" });


    const myCountry = me.location?.country;
    if (!myCountry) {
      return res.status(400).json({
        message:
          "Please set your location (Country) in profile settings first.",
      });
    }

    // ✅ Step 2: Get excluded users (Fresh from DB)
    const excludeIds = [
      currentUserId,
      ...(me.likedUsers || []).map((id) => id.toString()),
      ...(me.dislikedUsers || []).map((id) => id.toString()),
      ...(me.superLikedUsers || []).map((id) => id.toString()),
      ...(me.blockedUsers || []).map((id) => id.toString()),
      ...(me.blockedBy || []).map((id) => id.toString()),
    ];

    // Exclude users who have disliked me
    const usersWhoDislikedMe = await User.find({
      dislikedUsers: currentUserId,
    })
      .select("_id")
      .lean();
    usersWhoDislikedMe.forEach((u) => excludeIds.push(u._id.toString()));

    // ✅ Step 3: Check Redis cache AND FILTER IT
    // This prevents showing users that were JUST unlockd but are still in cache
    let cached = await getMatchesCache(currentUserId, "unlock");
    if (cached) {
      // Filter out anyone in our fresh exclude list
      const freshCached = cached.filter(
        (card) => !excludeIds.includes(card._id.toString())
      );

      // Only return if we still have cards after filtering
      if (freshCached.length > 0) {
        return res.status(200).json(freshCached);
      }
    }

    // ✅ Step 4: Try Redis Feed (Worker Generated)
    // The worker populates 'unlock:feed:{userId}' with candidate IDs
    const feedKey = `unlock:feed:${currentUserId}`;
    let candidateIds = [];

    // Try to pop 20 items from the feed
    // Note: lPop with count is available in Redis 6.2+. If older, we might need loop or lRange+lTrim.
    // Assuming modern Redis (Render usually provides 6.x or 7.x)
    try {
        // We use a simple loop or lRange for broader compatibility if needed, 
        // but let's try to get a batch.
        // For safety/compatibility, let's use lRange + lTrim (atomic-ish enough for this use case)
        // OR just pop one by one in a loop parallel? 
        // Better: Use lPop count if available, catch error if not.
        // Node Redis v4 supports .lPop(key, count).
        const feedItems = await redisClient.lPop(feedKey, 20); // Returns array of strings or null
        if (feedItems && Array.isArray(feedItems)) {
            candidateIds = feedItems.map(id => ({ _id: id })); 
            if (process.env.NODE_ENV !== "production") {
                console.log(`[unlockController] 🎯 Popped ${candidateIds.length} users from Redis Feed`);
            }
        } else if (typeof feedItems === 'string') {
             // Single item popped (if count param not supported/passed, tho v4 should handle it)
             candidateIds.push({ _id: feedItems });
        }
    } catch (err) {
        console.warn("[unlockController] Redis LPOP failed (maybe empty or old version), falling back.", err.message);
    }

    // ✅ Step 5: Fallback to DB if Redis Feed is empty/insufficient
    if (candidateIds.length < 20) {
      const needed = 20 - candidateIds.length;
      if (process.env.NODE_ENV !== "production") {
          console.log(`[unlockController] ⚠️ Redis Feed low/empty. Fetching ${needed} from DB (Fallback)`);
      }
      
      const dbCandidates = await getCandidatesFromDB(
        me,
        [...excludeIds, ...candidateIds.map(c => c._id.toString())], // Exclude what we already have
        needed
      );
      candidateIds = [...candidateIds, ...dbCandidates];
      
      // Optional: Trigger worker to refill if it was empty? 
      // The worker theoretically runs periodically, but we could trigger it here if critical.
      // For now, let's rely on the scheduled worker or the one-off triggers.
    }

    // ✅ Step 7: Fetch full user data for selected candidates
    const candidateUserIds = candidateIds.map((c) => c.userId || c._id);
    const candidates = await User.find({
      _id: { $in: candidateUserIds },
    })
      .select(
        "name birthday avatar gallery bio gender location voiceIntro interests dna isVerified"
      )
      .lean();

    // ✅ Step 8: Return basic card data (No heavy calculation)
    const enrichedCards = candidates.map((user) => {
        const commonInterest = user.interests?.find((i) =>
          me.interests?.includes(i)
        );
        const icebreakerHint = commonInterest
          ? `I noticed we both love ${commonInterest}! Tell me, what got you into it?`
          : `Your bio caught my attention. ${
              user.bio?.substring(0, 50) || "Let's chat!"
            }`;

        return {
          _id: user._id,
          name: user.name,
          age: user.birthday?.year
            ? new Date().getFullYear() - parseInt(user.birthday.year)
            : 25,
          avatar: user.avatar,
          gallery: user.gallery || [],
          bio: user.bio,
          gender: user.gender,
          location: user.location,
          voiceIntro: user.voiceIntro || null,
          matchScore: null, // Calculated on demand in Profile Details
          dna: null,        // Calculated on demand in Profile Details
          insights: null,   // Calculated on demand in Profile Details
          icebreaker: icebreakerHint,
          isPremiumCandidate: false, // Or calculate based on simple criteria if needed
        };
    });

    // Filter out nulls (locked users)
    const finalCards = enrichedCards.filter((card) => card !== null);

    // ✅ Step 9: Cache results (5 minutes)
    await setMatchesCache(currentUserId, "unlock", finalCards, 300);

    res.status(200).json(finalCards);
  } catch (error) {
    console.error("Get unlock Cards Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

/**
 * ✅ Helper: Get candidates from DB with smart selection
 * Uses DNA similarity for better matches
 */
async function getCandidatesFromDB(me, excludeIds, limit) {
  const myCountry = me.location?.country;
  const genderFilter = me.lookingFor || null;

  let query = {
    _id: { $nin: excludeIds },
    "location.country": myCountry,
  };

  if (genderFilter) {
    query.gender = genderFilter;
  }

  // ✅ Optimized: Random selection instead of heavy DNA sorting
  // This is much faster and provides better variety
  const candidates = await User.aggregate([
    { $match: query },
    { $sample: { size: limit } },
    {
      $project: {
        _id: 1,
      },
    },
  ]);

  return candidates;
}


/**
 * ✅ Optimized: Handle unlock Action
 * Updates Redis excluded list immediately
 */
import { unlockActionQueue } from "../../config/queue.js";
import { 
    addRedisLike, 
    checkRedisMatch, 
    incrementunlockCounter, 
    getunlockCounter 
} from "../../utils/redisMatchHelper.js";

// ... (existing isSameDay helper) ...

/**
 * ✅ High-Scale: Handle unlock Action (Redis-First + BullMQ)
 * Eliminates MongoDB transactions and write conflicts.
 */
export const handleunlockAction = async (req, res) => {
  try {
    const { targetUserId, action } = req.body;
    const currentUserId = req.user.userId;
    const io = req.app.get("io");

    if (!['left', 'right', 'up'].includes(action)) {
       return res.status(400).json({ message: "Invalid action" });
    }

    const now = new Date();

    // 1. Fetch Basic Requirements (No Transaction)
    // We only need plan info to check limits
    const me = await User.findById(currentUserId).select("name avatar subscription").lean();
    if (!me) return res.status(404).json({ message: "User not found" });

    // 2. Phase 3: Check Limits using Redis Atomic Counters
    const userPlan = me.subscription?.plan || "free";
    const unlockLimit = getunlockLimit(userPlan);
    const superLikeLimit = getSuperLikeLimit(userPlan);

    // Get current counts from Redis (Fast)
    const dailyunlocks = await getunlockCounter(currentUserId, "unlocks");
    const dailySuperLikes = await getunlockCounter(currentUserId, "superlikes");

    if ((action === "right" || action === "left") && unlockLimit !== Infinity && dailyunlocks >= unlockLimit) {
         return res.status(403).json({ message: "Daily unlock limit reached.", errorLabel: "Limit Reached" });
    }
    if (action === "up") {
         if (superLikeLimit !== Infinity && dailySuperLikes >= superLikeLimit) {
              return res.status(403).json({ message: "Daily Super Like limit reached.", errorLabel: "Limit Reached" });
         }
    }

    // 3. Increment Redis Counters (Atomic)
    await incrementunlockCounter(currentUserId, "unlocks");
    if (action === "up") {
        await incrementunlockCounter(currentUserId, "superlikes");
    }

    // 4. Phase 1: Redis Pre-Match Logic (Likes/Superlikes Only)
    let isMatch = false;
    if (action === "right" || action === "up") {
        // Record my like in Redis for future pre-match checks
        await addRedisLike(currentUserId, targetUserId);
        
        // Check if target has already liked me
        isMatch = await checkRedisMatch(currentUserId, targetUserId);
    }

    // 5. Phase 2: Dispatch Job to BullMQ for MongoDB Persistence
    await unlockActionQueue.add(`unlock-${currentUserId}-${targetUserId}`, {
        userId: currentUserId,
        targetUserId,
        action,
        isMatch,
        timestamp: now
    });

    // 6. Instant Socket Notifications (Match/SuperLike)
    if (action === "up") {
        emitNotification(io, targetUserId, {
            type: "SUPER_LIKE",
            senderId: currentUserId,
            senderName: me.name,
            senderAvatar: me.avatar,
            message: "You received a Super Like! 🌟",
            targetId: currentUserId.toString(),
        });
    }

    if (isMatch) {
        // Notify both users immediately via socket
        emitNotification(io, targetUserId, {
            type: "MATCH",
            senderId: currentUserId,
            senderName: me.name,
            senderAvatar: me.avatar,
            message: "It's a Match! ❤️",
            targetId: currentUserId.toString(),
        });
        
        // Note: For the current user, we return isMatch: true in the response
    }

    // 7. Phase 4: Redis-Only Exclusion (already handled by fire-and-forget in legacy, but let's keep it here)
    addExcludedUser(currentUserId, targetUserId).catch(err => console.error("Redis exclusion error:", err));

    // 8. Return Success Response Immediately (Sub-20ms)
    return res.status(200).json({
         success: true,
         isMatch,
         matchDetails: isMatch ? {
             id: targetUserId,
             // Note: Name/Avatar will be populated by frontend or we can fetch targetUser here if needed.
             // For performance, frontend usually has this in the unlockCard prop already.
         } : null,
         updatedUsage: {
             unlocksCount: dailyunlocks + 1,
             superLikesCount: action === "up" ? dailySuperLikes + 1 : dailySuperLikes
         }
    });

  } catch (error) {
    console.error("High-Scale unlock Error:", error);
    res.status(500).json({ message: "Interaction failed. Please try again." });
  }
};

