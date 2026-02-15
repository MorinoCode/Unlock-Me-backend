import User from "../../models/User.js";
// import mongoose from "mongoose";
import {
  calculateCompatibility,
//   calculateUserDNA,
//   generateMatchInsights,
} from "../../utils/matchUtils.js";
// import { emitNotification } from "../../utils/notificationHelper.js";
import {
  getSwipeLimit,
  // getSuperLikeLimit,
  // getVisibilityThreshold,
} from "../../utils/subscriptionRules.js";
// ✅ Performance Fix: Import cache helpers
import {
  // getMatchesCache,
  setMatchesCache,
  // invalidateUserCache,
} from "../../utils/cacheHelper.js";
import redisClient from "../../config/redis.js";
import { addToSwipeFeedQueue } from "../../queues/swipeFeedQueue.js";

export const getSwipeCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const me = await User.findById(currentUserId);
    
    if (!me) {
        return res.status(404).json({ message: "User not found" });
    }

    // ✅ NEW ARCHITECTURE: Fetch from Redis feed instead of live aggregation
    const feedKey = `swipe:feed:${currentUserId}`;
    console.log(`[SwipeCards] Checking Redis feed: ${feedKey}`);

    let feedIds = await redisClient.lRange(feedKey, 0, 19); // Get first 20 IDs
    console.log(`[SwipeCards] Feed IDs from Redis: ${feedIds.length}`);

    // If feed is empty or low, trigger refill via BULLMQ
    if (feedIds.length < 20) { // Threshold 20
      console.log(`⚠️ [SwipeCards] Feed LOW/EMPTY (${feedIds.length} < 20). Triggering refill job...`);
      // Trigger Queue Job
      addToSwipeFeedQueue(currentUserId, true).catch(err => 
        console.error(`Queue add failed for ${currentUserId}:`, err)
      );
      
      // If completely empty, wait briefly for worker to process
      if (feedIds.length === 0) {
        console.log(`[SwipeCards] Feed completely empty. Waiting 2s for worker...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        feedIds = await redisClient.lRange(feedKey, 0, 19);
        console.log(`[SwipeCards] After wait, feed size: ${feedIds.length}`);
      }
    } else {
      console.log(`✅ [SwipeCards] Feed OK (${feedIds.length} users available)`);
    }

    // If still no feed (new user or error), return empty
    if (feedIds.length === 0) {
      console.error(`❌ [SwipeCards] NO FEED AVAILABLE for ${currentUserId}!`);
      console.error(`❌ [SwipeCards] Possible причины:`);
      console.error(`   1. Worker not run during signup`);
      console.error(`   2. Redis connection issue`);
      console.error(`   3. No users in database match criteria`);
      console.log(`========================================\n`);
      return res.status(200).json({
        cards: [],
        message: "No more cards available. Please check back later."
      });
    }

    console.log(`[SwipeCards] Fetching ${feedIds.length} user details from MongoDB...`);
    const candidates = await User.find({ _id: { $in: feedIds } })
      .select("name birthday avatar gallery bio gender location voiceIntro interests dna isVerified")
      .lean();

    console.log(`[SwipeCards] Fetched ${candidates.length} users from DB`);

    // Preserve order from Redis feed
    const orderedCandidates = feedIds
      .map(id => candidates.find(c => c._id.toString() === id))
      .filter(Boolean);

    console.log(`[SwipeCards] Ordered candidates: ${orderedCandidates.length}`);

    // ✅ Performance Optimization: Create Set of unlocked strings for O(1) lookup
    const unlockedSet = new Set((me.unlockedProfiles || []).map(id => id.toString()));

    const enrichedCards = candidates
      .map((user) => {
        const preCalculatedMatch = me.potentialMatches?.find(
          (m) => m.user.toString() === user._id.toString()
        );

        let compatibility = preCalculatedMatch
          ? preCalculatedMatch.matchScore
          : calculateCompatibility(me, user);

        // ✅ Apply Visibility Threshold: Filter out users with score above threshold
        // UNLESS the user has already unlocked this profile.
        // REVISED LOGIC (User Feedback): In "Unlock Me", ALL cards should be locked by default.
        // You must spend a key to unlock them.
        const isManuallyUnlocked = unlockedSet.has(user._id.toString());
        const isLocked = !isManuallyUnlocked; // Always locked unless unlocked
        
        /* 
           Legacy Visibility Logic (Disabled for now as per "Unlock Me" core mechanic request):
           const isLocked = !isManuallyUnlocked && (compatibility > visibilityThreshold);
        */

        // const dnaProfile = calculateUserDNA(user);
        // const insights = generateMatchInsights(me, user);

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
          matchScore: compatibility,
          // dna: dnaProfile, // Fetched on demand
          // insights: insights, // Fetched on demand
          icebreaker: icebreakerHint, // Keep for now or remove if unused? User didn't ask to remove, but it's derived from insights. Let's keep small strings.
          isPremiumCandidate: compatibility >= 90,
          isLocked: isLocked, // ✅ New: Indicates if user is locked due to visibility threshold
        };
      })
      .filter((card) => !card.isLocked || card.isLocked); // Keep all, frontend handles display. Wait, original filtered `!card.isLocked`. 
      // The requirement is "locked cards are hidden/blurred", not removed from feed entirely?
      // Actually, standard practice for "Visibility Threshold" usually means you CAN see them but they are BLURRED.
      // So I should NOT filter them out if they are locked.
      // However, previous code was `.filter((card) => !card.isLocked);`. 
      // This implies that cards ABOVE the threshold were being REMOVED from the feed entirely?
      // That sounds wrong. If they are "Premium Candidates" (high compatibility), they should be SHOWN but LOCKED.
      // Let's check `isLocked` logic again.
      // `const isLocked = compatibility > visibilityThreshold;`
      // If compatibility is 95 and limit is 80, isLocked = true.
      // If we filter `!card.isLocked`, then high match users are HIDDEN? That reverses the logic!
      // High match users should be LOCKED (blurred), low match users are UNLOCKED (visible)? 
      // USUALLY: You see everyone, but high value ones are locked.
      // OR: You see everyone, but only interact with some?
      // Let's assume the previous logic `.filter((card) => !card.isLocked)` was actually removing them?
      // Wait, if I look at line 160 of original file: `.filter((card) => !card.isLocked);`
      // This means "Only return cards that are NOT locked". 
      // So if `isLocked` is true, the user never sees them.
      // The user COMPLAINT: "locked cards... need key to open". This implies they DO see them.
      // So the filter must have been WRONG or I misunderstood `visibilityThreshold`.
      // `getVisibilityThreshold` usually returns a score (e.g. 100). If score > 100? No.
      // Maybe `visibilityThreshold` is "Maximum Score Visible for Free"?
      // Let's assume the INTENT is to RETURN all cards, but mark some as locked.
      // So I will REMOVE the filter.


    // ✅ Performance Fix: Cache the results
    await setMatchesCache(currentUserId, "swipe", enrichedCards, 180); // 3 minutes

    res.status(200).json(enrichedCards);
  } catch (error) {
    console.error("Get Swipe Cards Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

import { addToSwipeActionQueue } from "../../queues/swipeActionQueue.js";

export const handleSwipeAction = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const { targetUserId, action } = req.body;

    if (!targetUserId || !action) {
      return res.status(400).json({ message: "Invalid data." });
    }

    // 1. FAST LIMIT CHECK (Redis or Simple DB Read - No Transaction)
    // For 1M scale, we ideally use Redis counters. Here we do a fast DB read (LEAN).
    const currentUserData = await User.findById(currentUserId)
            .select("subscription usage likedUsers dislikedUsers superLikedUsers")
            .lean(); // Faster

    if (!currentUserData) return res.status(404).json({ message: "User not found" });

    // Deduplication (Optimistic)
    // Note: Queue worker has final say, but we filter here for UX speed
    const alreadyInteract = 
        currentUserData.likedUsers?.some(id => id.toString() === targetUserId) ||
        currentUserData.dislikedUsers?.some(id => id.toString() === targetUserId) ||
        currentUserData.superLikedUsers?.some(id => id.toString() === targetUserId);
    
    if (alreadyInteract && action !== 'skip') {
         return res.status(400).json({ message: "Already swiped" });
    }

    // --- LIMITS (simplified for speed) ---
    const userPlan = currentUserData.subscription?.plan || "free";
    const swipeLimit = getSwipeLimit(userPlan);
    // const superLikeLimit = getSuperLikeLimit(userPlan);
    
    // Check usage simply
    // Ideally this logic moves to Redis for strict high-scale enforcement
    // For now, we trust the localized read.
    const swipesToday = currentUserData.usage?.swipesCount || 0;
    
    if (action === 'right' || action === 'left') {
        if (swipeLimit !== Infinity && swipesToday >= swipeLimit) {
             return res.status(403).json({ error: "Limit Reached", message: "Daily limit reached" });
        }
    }

    // 2. FAST MATCH CHECK (Read-Only)
    // To show "It's a Match!" immediately, we need to check if target user liked us.
    let isMatch = false;
    let matchDetails = null;

    if (action === 'right' || action === 'up') {
        const targetUser = await User.findById(targetUserId)
            .select("likedUsers superLikedUsers name avatar")
            .lean();

        if (targetUser) {
             isMatch = (targetUser.likedUsers || []).some(id => id.toString() === currentUserId.toString()) ||
                       (targetUser.superLikedUsers || []).some(id => id.toString() === currentUserId.toString());
             
             if (isMatch) {
                 matchDetails = {
                     name: targetUser.name,
                     avatar: targetUser.avatar,
                     id: targetUser._id
                 };
             }
        }
    }

    // 3. ASYNC PROCESSING (Queue)
    // Offload the heavy writes (Transaction, Updates, Cache Invalidation) to Worker
    await addToSwipeActionQueue({
        userId: currentUserId,
        targetUserId,
        action,
        isMatch // Pass our calculation to worker so it knows to create Match record
    });

    // 4. Redis Feed Cleanup (Shared)
    try {
      const feedKey = `swipe:feed:${currentUserId}`;
      const historyKey = `swipe:history:${currentUserId}`;
      await redisClient.lRem(feedKey, 1, targetUserId.toString());
      await redisClient.sAdd(historyKey, targetUserId.toString());
      await redisClient.expire(historyKey, 7 * 24 * 60 * 60);

      // Auto-refill check (Fire & Forget)
      const len = await redisClient.lLen(feedKey);
      if (len < 20) {
           addToSwipeFeedQueue(currentUserId, false).catch(() => {});
      }
    } catch (e) {
        console.error("Redis feed update error", e);
    }

    // 5. Return Success Immediately
    res.status(200).json({
      success: true,
      isMatch,
      matchDetails,
      updatedUsage: {
          // Return optimistic usage for frontend counter
          swipesCount: swipesToday + 1
      }
    });

  } catch (error) {
    console.error("Swipe Action Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};
