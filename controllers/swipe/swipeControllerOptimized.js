/**
 * ✅ Scalability Optimization: Optimized Swipe Controller
 * برای میلیون‌ها کاربر با استفاده از Redis
 */

import User from "../../models/User.js";
import mongoose from "mongoose";
import {
  calculateCompatibility,
  calculateUserDNA,
  generateMatchInsights,
} from "../../utils/matchUtils.js";
import { emitNotification } from "../../utils/notificationHelper.js";
import {
  getSwipeLimit,
  getSuperLikeLimit,
  getVisibilityThreshold,
} from "../../utils/subscriptionRules.js";
import {
  getMatchesCache,
  setMatchesCache,
  invalidateUserCache,
  invalidateMatchesCache,
  invalidateExploreCache,
} from "../../utils/cacheHelper.js";
import {
  getCompatibilityScore,
  setCompatibilityScore,
  getTopCandidates,
  addExcludedUser,
  getFromPotentialPool,
  invalidateUserCaches,
} from "../../utils/redisMatchHelper.js";

const isSameDay = (d1, d2) => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

/**
 * ✅ Optimized: Get Swipe Cards with Redis
 * Strategy:
 * 1. Check Redis cache first (5 minutes)
 * 2. Try Redis ranking pool (pre-computed top candidates)
 * 3. Fallback to DB with Redis compatibility scores
 */
export const getSwipeCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;

    // ✅ Log: Confirm optimized controller is being used
    if (process.env.NODE_ENV !== "production") {
      console.log("🚀 Using Optimized Swipe Controller with Redis");
    }

    // ✅ Step 1: Check Redis cache first (5 minutes instead of 3)
    const cached = await getMatchesCache(currentUserId, "swipe");
    if (cached) {
      return res.status(200).json(cached);
    }

    // ✅ Step 2: Get user data
    const me = await User.findById(currentUserId)
      .select(
        "location interests lookingFor potentialMatches likedUsers dislikedUsers superLikedUsers dna birthday gender subscription"
      )
      .lean();

    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";
    const visibilityThreshold = getVisibilityThreshold(userPlan);

    const myCountry = me.location?.country;
    if (!myCountry) {
      return res.status(400).json({
        message:
          "Please set your location (Country) in profile settings first.",
      });
    }

    // ✅ Step 3: Get excluded users (already swiped + users who disliked me)
    const excludeIds = [
      currentUserId,
      ...(me.likedUsers || []).map((id) => id.toString()),
      ...(me.dislikedUsers || []).map((id) => id.toString()),
      ...(me.superLikedUsers || []).map((id) => id.toString()),
    ];

    // ✅ Exclude users who have disliked me (index: dislikedUsers)
    const usersWhoDislikedMe = await User.find({
      dislikedUsers: currentUserId,
    })
      .select("_id")
      .lean();
    usersWhoDislikedMe.forEach((u) => excludeIds.push(u._id.toString()));

    // ✅ Step 4: Try Redis ranking pool first (pre-computed top candidates)
    const genderFilter = me.lookingFor || null;
    let candidateIds = await getFromPotentialPool(
      currentUserId,
      20,
      excludeIds
    );

    // ✅ Step 5: If Redis pool is empty or insufficient, try ranking pool
    if (candidateIds.length < 20) {
      const rankingCandidates = await getTopCandidates(
        currentUserId,
        myCountry,
        genderFilter,
        20 - candidateIds.length,
        excludeIds
      );
      candidateIds = [...candidateIds, ...rankingCandidates];
    }

    // ✅ Step 6: If still not enough, fallback to DB with smart selection
    if (candidateIds.length < 20) {
      const dbCandidates = await getCandidatesFromDB(
        me,
        excludeIds,
        20 - candidateIds.length
      );
      candidateIds = [...candidateIds, ...dbCandidates];
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

    // ✅ Step 8: Enrich cards with compatibility scores from Redis or calculate
    const enrichedCards = await Promise.all(
      candidates.map(async (user) => {
        // Try Redis first
        let compatibility = await getCompatibilityScore(
          currentUserId,
          user._id.toString()
        );

        // If not in Redis, check potentialMatches
        if (compatibility === null) {
          const preCalculatedMatch = me.potentialMatches?.find(
            (m) => m.user.toString() === user._id.toString()
          );
          compatibility = preCalculatedMatch
            ? preCalculatedMatch.matchScore
            : calculateCompatibility(me, user);

          // Store in Redis for future use
          await setCompatibilityScore(
            currentUserId,
            user._id.toString(),
            compatibility
          );
        }

        const isLocked = compatibility > visibilityThreshold;
        if (isLocked) return null; // Filter locked users

        const dnaProfile = calculateUserDNA(user);
        const insights = generateMatchInsights(me, user);

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
          dna: dnaProfile,
          insights: insights,
          icebreaker: icebreakerHint,
          isPremiumCandidate: compatibility >= 90,
        };
      })
    );

    // Filter out nulls (locked users)
    const finalCards = enrichedCards.filter((card) => card !== null);

    // ✅ Step 9: Cache results (5 minutes)
    await setMatchesCache(currentUserId, "swipe", finalCards, 300);

    res.status(200).json(finalCards);
  } catch (error) {
    console.error("Get Swipe Cards Error:", error);
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
    dna: { $exists: true, $ne: null },
  };

  if (genderFilter) {
    query.gender = genderFilter;
  }

  // ✅ Smart selection: Use DNA similarity instead of random
  const myDNA = me.dna || {
    Logic: 50,
    Emotion: 50,
    Energy: 50,
    Creativity: 50,
    Discipline: 50,
  };

  const candidates = await User.aggregate([
    { $match: query },
    {
      $addFields: {
        dnaDiff: {
          $add: [
            {
              $abs: {
                $subtract: [{ $ifNull: ["$dna.Logic", 50] }, myDNA.Logic],
              },
            },
            {
              $abs: {
                $subtract: [{ $ifNull: ["$dna.Emotion", 50] }, myDNA.Emotion],
              },
            },
            {
              $abs: {
                $subtract: [{ $ifNull: ["$dna.Energy", 50] }, myDNA.Energy],
              },
            },
            {
              $abs: {
                $subtract: [
                  { $ifNull: ["$dna.Creativity", 50] },
                  myDNA.Creativity,
                ],
              },
            },
            {
              $abs: {
                $subtract: [
                  { $ifNull: ["$dna.Discipline", 50] },
                  myDNA.Discipline,
                ],
              },
            },
          ],
        },
      },
    },
    { $sort: { dnaDiff: 1 } }, // Lower diff = better match
    { $limit: limit },
    {
      $project: {
        _id: 1,
      },
    },
  ]);

  return candidates;
}

/**
 * ✅ Optimized: Handle Swipe Action
 * Updates Redis excluded list immediately
 */
export const handleSwipeAction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const currentUserId = req.user._id || req.user.userId;
    const { targetUserId, action } = req.body;
    const io = req.app.get("io");

    if (!targetUserId || !action) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid data." });
    }

    const targetUser = await User.findById(targetUserId)
      .select("name avatar likedUsers superLikedUsers")
      .session(session);
    if (!targetUser) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Target user not found" });
    }

    const currentUserData = await User.findById(currentUserId)
      .select(
        "name avatar subscription usage likedUsers dislikedUsers superLikedUsers"
      )
      .session(session);
    if (!currentUserData) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Current user not found" });
    }

    // ✅ Check if already swiped
    const alreadyLiked = currentUserData.likedUsers?.some(
      (id) => id.toString() === targetUserId.toString()
    );
    const alreadyDisliked = currentUserData.dislikedUsers?.some(
      (id) => id.toString() === targetUserId.toString()
    );
    const alreadySuperLiked = currentUserData.superLikedUsers?.some(
      (id) => id.toString() === targetUserId.toString()
    );

    if (alreadyLiked || alreadyDisliked || alreadySuperLiked) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ message: "You have already swiped on this user" });
    }

    // ✅ Limit checks
    const userPlan = currentUserData.subscription?.plan || "free";
    const swipeLimit = getSwipeLimit(userPlan);
    const superLikeLimit = getSuperLikeLimit(userPlan);

    const now = new Date();
    const lastSwipeDate = currentUserData.usage?.lastSwipeDate
      ? new Date(currentUserData.usage.lastSwipeDate)
      : null;

    let swipesToday = currentUserData.usage?.swipesCount || 0;
    let superLikesToday = currentUserData.usage?.superLikesCount || 0;

    let isResetting = false;
    if (lastSwipeDate && !isSameDay(now, lastSwipeDate)) {
      isResetting = true;
      swipesToday = 0;
      superLikesToday = 0;
    }

    if (
      (action === "right" || action === "left") &&
      swipeLimit !== Infinity &&
      swipesToday >= swipeLimit
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        error: "Limit Reached",
        message: "Daily swipe limit reached.",
      });
    }

    if (
      action === "up" &&
      superLikeLimit !== Infinity &&
      superLikesToday >= superLikeLimit
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        error: "Limit Reached",
        message: "Daily Super Like limit reached.",
      });
    }

    // ✅ DB Updates
    let isMatch = false;
    let updateQuery = {};

    if (action === "left") {
      updateQuery = { $addToSet: { dislikedUsers: targetUserId } };

      if (isResetting) {
        updateQuery["$set"] = {
          "usage.swipesCount": 1,
          "usage.superLikesCount": 0,
          "usage.lastSwipeDate": now,
        };
      } else {
        updateQuery["$inc"] = { "usage.swipesCount": 1 };
        updateQuery["$set"] = { "usage.lastSwipeDate": now };
      }
    } else if (action === "right" || action === "up") {
      const updateField = action === "right" ? "likedUsers" : "superLikedUsers";
      updateQuery = { $addToSet: { [updateField]: targetUserId } };

      if (isResetting) {
        updateQuery["$set"] = {
          "usage.swipesCount": 1,
          "usage.lastSwipeDate": now,
          "usage.superLikesCount": action === "up" ? 1 : 0,
        };
      } else {
        updateQuery["$set"] = { "usage.lastSwipeDate": now };
        if (action === "up") {
          updateQuery["$inc"] = {
            "usage.swipesCount": 1,
            "usage.superLikesCount": 1,
          };
        } else {
          updateQuery["$inc"] = { "usage.swipesCount": 1 };
        }
      }
    }

    await User.findByIdAndUpdate(currentUserId, updateQuery, { session });

    // ✅ Immediately update Redis excluded list (non-blocking)
    addExcludedUser(currentUserId, targetUserId).catch((err) =>
      console.error("Redis excluded update error:", err)
    );

    if (action === "up") {
      await User.findByIdAndUpdate(
        targetUserId,
        {
          $addToSet: { superLikedBy: currentUserId },
        },
        { session }
      );
    }

    const updatedTargetUser = await User.findById(targetUserId)
      .select("likedUsers superLikedUsers")
      .session(session);

    // ✅ Match Detection
    if (action === "right" || action === "up") {
      const hasLikedMe =
        (updatedTargetUser.likedUsers || []).some(
          (id) => id.toString() === currentUserId.toString()
        ) ||
        (updatedTargetUser.superLikedUsers || []).some(
          (id) => id.toString() === currentUserId.toString()
        );

      if (hasLikedMe) {
        isMatch = true;

        await User.findByIdAndUpdate(
          currentUserId,
          {
            $addToSet: { matches: targetUserId },
          },
          { session }
        );

        await User.findByIdAndUpdate(
          targetUserId,
          {
            $addToSet: { matches: currentUserId },
          },
          { session }
        );

        emitNotification(io, targetUserId, {
          type: "MATCH",
          senderId: currentUserId,
          senderName: currentUserData.name,
          senderAvatar: currentUserData.avatar,
          message: "It's a Match! ❤️",
          targetId: currentUserId.toString(),
        });

        emitNotification(io, currentUserId, {
          type: "MATCH",
          senderId: targetUserId,
          senderName: targetUser.name,
          senderAvatar: targetUser.avatar,
          message: "New Match! 🔥",
          targetId: targetUserId.toString(),
        });
      }
    }

    await session.commitTransaction();

    // ✅ Invalidate caches (non-blocking) + swipe, explore, matches dashboard so next requests are fresh
    const matchTypes = ["matches_dashboard", "mutual", "incoming", "sent", "superlikes"];
    const invalidateCurrent = matchTypes.map((t) => invalidateMatchesCache(currentUserId, t));
    const invalidateTarget = matchTypes.map((t) => invalidateMatchesCache(targetUserId, t));
    Promise.all([
      invalidateUserCache(currentUserId),
      invalidateUserCache(targetUserId),
      invalidateUserCaches(currentUserId),
      invalidateMatchesCache(currentUserId, "swipe"),
      invalidateExploreCache(currentUserId),
      ...invalidateCurrent,
      ...invalidateTarget,
    ]).catch((err) => console.error("Cache invalidation error:", err));

    res.status(200).json({
      success: true,
      isMatch,
      matchDetails: isMatch
        ? {
            name: targetUser.name,
            avatar: targetUser.avatar,
            id: targetUser._id,
          }
        : null,
      updatedUsage: {
        swipesCount: isResetting ? 1 : swipesToday + 1,
        superLikesCount:
          action === "up"
            ? isResetting
              ? 1
              : superLikesToday + 1
            : isResetting
            ? 0
            : superLikesToday,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Handle Swipe Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message;
    res.status(500).json({ message: errorMessage });
  } finally {
    session.endSession();
  }
};
