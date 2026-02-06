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
// ✅ Performance Fix: Import cache helpers
import {
  getMatchesCache,
  setMatchesCache,
  invalidateUserCache,
} from "../../utils/cacheHelper.js";

const isSameDay = (d1, d2) => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

export const getSwipeCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;

    // ✅ Performance Fix: Try cache first
    const cacheKey = `swipe:${currentUserId}`;
    const cached = await getMatchesCache(currentUserId, "swipe");
    if (cached) {
      return res.status(200).json(cached);
    }

    const me = await User.findById(currentUserId)
      .select(
        "location interests lookingFor potentialMatches likedUsers dislikedUsers superLikedUsers likedBy dna birthday gender subscription"
      )
      .lean();

    if (!me) return res.status(404).json({ message: "User not found" });

    // ✅ Apply Visibility Threshold based on subscription plan
    const userPlan = me.subscription?.plan || "free";
    const visibilityThreshold = getVisibilityThreshold(userPlan);

    const myCountry = me.location?.country;
    if (!myCountry) {
      return res.status(400).json({
        message:
          "Please set your location (Country) in profile settings first.",
      });
    }

    // ✅ Exclude users I've already interacted with
    const excludeIds = [
      currentUserId,
      ...(me.likedUsers || []).map((id) => id.toString()),
      ...(me.dislikedUsers || []).map((id) => id.toString()),
      ...(me.superLikedUsers || []).map((id) => id.toString()),
    ];

    // ✅ Also exclude users who have disliked me (bidirectional exclusion)
    // Find users who have me in their dislikedUsers array
    const usersWhoDislikedMe = await User.find({
      dislikedUsers: currentUserId
    })
      .select("_id")
      .lean();
    
    const usersWhoDislikedMeIds = usersWhoDislikedMe.map(u => u._id.toString());
    excludeIds.push(...usersWhoDislikedMeIds);

    // ✅ Performance Fix: Better query optimization
    let query = {
      _id: { $nin: excludeIds },
      "location.country": myCountry, // Use exact match instead of regex for better performance
      dna: { $exists: true, $ne: null }, // Only users with DNA
    };

    if (me.lookingFor) {
      query.gender = me.lookingFor;
    }

    // ✅ Performance Fix: Optimized aggregation - match before sample
    const candidates = await User.aggregate([
      { $match: query },
      { $sample: { size: 20 } },
      {
        $project: {
          name: 1,
          birthday: 1,
          avatar: 1,
          gallery: 1,
          bio: 1,
          gender: 1,
          location: 1,
          voiceIntro: 1,
          interests: 1,
          dna: 1,
          isVerified: 1,
        },
      },
    ]);

    const enrichedCards = candidates
      .map((user) => {
        const preCalculatedMatch = me.potentialMatches?.find(
          (m) => m.user.toString() === user._id.toString()
        );

        let compatibility = preCalculatedMatch
          ? preCalculatedMatch.matchScore
          : calculateCompatibility(me, user);

        // ✅ Apply Visibility Threshold: Filter out users with score above threshold
        const isLocked = compatibility > visibilityThreshold;

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
          isLocked: isLocked, // ✅ New: Indicates if user is locked due to visibility threshold
        };
      })
      .filter((card) => !card.isLocked); // ✅ Filter out locked users

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

export const handleSwipeAction = async (req, res) => {
  // ✅ Bug Fix: Race condition prevention using MongoDB transactions
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

    // ✅ Bug Fix: Use session for atomic operations
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

    // ✅ Bug Fix: Check if already swiped (prevent duplicate swipes)
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

    // --- LIMIT CHECKS (CONNECTED TO RULES) ---
    const userPlan = currentUserData.subscription?.plan || "free";
    // ✅ Use Imported Functions
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
      return res
        .status(403)
        .json({
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
      return res
        .status(403)
        .json({
          error: "Limit Reached",
          message: "Daily Super Like limit reached.",
        });
    }

    // --- DB UPDATES ---
    let isMatch = false;
    let updateQuery = {};
    let finalUsageUpdate = {};

    if (action === "left") {
      updateQuery = { $addToSet: { dislikedUsers: targetUserId } };

      if (isResetting) {
        finalUsageUpdate = {
          "usage.swipesCount": 1,
          "usage.superLikesCount": 0,
          "usage.lastSwipeDate": now,
        };
        updateQuery["$set"] = finalUsageUpdate;
      } else {
        updateQuery["$inc"] = { "usage.swipesCount": 1 };
        updateQuery["$set"] = { "usage.lastSwipeDate": now };
      }
    } else if (action === "right" || action === "up") {
      const updateField = action === "right" ? "likedUsers" : "superLikedUsers";
      updateQuery = { $addToSet: { [updateField]: targetUserId } };

      if (isResetting) {
        finalUsageUpdate = {
          "usage.swipesCount": 1,
          "usage.lastSwipeDate": now,
          "usage.superLikesCount": action === "up" ? 1 : 0,
        };
        updateQuery["$set"] = finalUsageUpdate;
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

    // ✅ Bug Fix: Atomic updates using session
    await User.findByIdAndUpdate(currentUserId, updateQuery, { session });

    // Update target user's likedBy/superLikedBy arrays
    if (action === "right") {
      // Add current user to target user's likedBy array
      await User.findByIdAndUpdate(
        targetUserId,
        {
          $addToSet: { likedBy: currentUserId },
        },
        { session }
      );
    } else if (action === "up") {
      // Add current user to target user's superLikedBy array
      await User.findByIdAndUpdate(
        targetUserId,
        {
          $addToSet: { superLikedBy: currentUserId },
        },
        { session }
      );
    } else if (action === "left") {
      // Remove from likedBy/superLikedBy if exists (in case user changes mind)
      await User.findByIdAndUpdate(
        targetUserId,
        {
          $pull: { likedBy: currentUserId, superLikedBy: currentUserId },
        },
        { session }
      );
    }

    // ✅ Bug Fix: Re-fetch targetUser after potential updates for accurate match detection
    // Need to check both likedUsers and likedBy for match detection
    const updatedTargetUser = await User.findById(targetUserId)
      .select("likedUsers superLikedUsers likedBy")
      .session(session);

    // --- MATCH DETECTION ---
    if (action === "right" || action === "up") {
      // Check if target user has liked me (either in likedUsers or likedBy)
      const hasLikedMe =
        (updatedTargetUser.likedUsers || []).some(
          (id) => id.toString() === currentUserId.toString()
        ) ||
        (updatedTargetUser.superLikedUsers || []).some(
          (id) => id.toString() === currentUserId.toString()
        ) ||
        (updatedTargetUser.likedBy || []).some(
          (id) => id.toString() === currentUserId.toString()
        );

      if (hasLikedMe) {
        isMatch = true;

        // ✅ Bug Fix: Create match in both users' matches array atomically
        // Also remove from likedBy/superLikedBy and add to matches
        await User.findByIdAndUpdate(
          currentUserId,
          {
            $addToSet: { matches: targetUserId },
            $pull: { likedBy: targetUserId, superLikedBy: targetUserId }, // Remove from likedBy/superLikedBy if exists
          },
          { session }
        );

        await User.findByIdAndUpdate(
          targetUserId,
          {
            $addToSet: { matches: currentUserId },
            $pull: { likedBy: currentUserId, superLikedBy: currentUserId }, // Remove from likedBy/superLikedBy if exists
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
      } else if (action === "up") {
        // ✅ Super Like Notification (only if not a match)
        emitNotification(io, targetUserId, {
          type: "SUPER_LIKE",
          senderId: currentUserId,
          senderName: currentUserData.name,
          senderAvatar: currentUserData.avatar,
          message: `${currentUserData.name} Super Liked you! ⭐`,
          targetId: currentUserId.toString(),
        });
      }
    }

    // ✅ Bug Fix: Commit transaction
    await session.commitTransaction();

    // ✅ Performance Fix: Invalidate cache after swipe
    await invalidateUserCache(currentUserId);
    await invalidateUserCache(targetUserId);

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
    // ✅ Bug Fix: Abort transaction on error
    await session.abortTransaction();
    console.error("Handle Swipe Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message;
    res.status(500).json({ message: errorMessage });
  } finally {
    // ✅ Bug Fix: Always end session
    session.endSession();
  }
};
