import User from "../../models/User.js";
import { calculateCompatibility, generateMatchInsights } from "../../utils/matchUtils.js";
import { getVisibilityThreshold, getMatchListLimit } from "../../utils/subscriptionRules.js";
// ✅ Performance Fix: Import cache helpers
import { getMatchesCache, setMatchesCache } from "../../utils/cacheHelper.js";

export const getMatchesDashboard = async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const currentUserId = req.user.userId;
    
    // ✅ Performance Fix: Try cache first
    if (type) {
      const cached = await getMatchesCache(currentUserId, type);
      if (cached) {
        return res.status(200).json(cached);
      }
    }
    
    const user = await User.findById(currentUserId)
      .select("likedUsers likedBy matches superLikedBy dislikedUsers blockedUsers blockedBy interests lookingFor gender location birthday questionsbycategoriesResults subscription dna")
      .lean();
      
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Bug Fix: Use matches array if available (more efficient)
    const myLikedIds = (user.likedUsers || []).map(id => id.toString());
    const myLikedByIds = (user.likedBy || []).map(id => id.toString());
    const myMatchesIds = (user.matches || []).map(id => id.toString());
    const mySuperLikedByIds = (user.superLikedBy || []).map(id => id.toString());
    
    // ✅ Performance Optimization: Use Sets for O(1) lookups instead of O(N)
    const myLikedIdsSet = new Set(myLikedIds);
    const myLikedByIdsSet = new Set(myLikedByIds);
    const myMatchesIdsSet = new Set(myMatchesIds);
    const myDislikedIdsSet = new Set((user.dislikedUsers || []).map(id => id.toString()));
    const myBlockedIdsSet = new Set([
      ...(user.blockedUsers || []).map(id => id.toString()),
      ...(user.blockedBy || []).map(id => id.toString()),
    ]);

    
    // Get visibility threshold for current user's plan
    const userPlan = user.subscription?.plan || "free";
    const visibilityThreshold = getVisibilityThreshold(userPlan);

    if (!type) {
      // ✅ Cache full dashboard (no type)
      const cachedDashboard = await getMatchesCache(currentUserId, "matches_dashboard");
      if (cachedDashboard) return res.status(200).json(cachedDashboard);
    }

    if (type) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      let targetIds = [];
      let isIncomingType = false;

      if (type === 'mutual') {
        targetIds = myMatchesIds.length > 0 
          ? myMatchesIds.filter(id => !myDislikedIdsSet.has(id) && !myBlockedIdsSet.has(id))
          : myLikedIds.filter(id => myLikedByIdsSet.has(id) && !myDislikedIdsSet.has(id) && !myBlockedIdsSet.has(id));
      } 
      else if (type === 'incoming') {
        isIncomingType = true;
        // Merge superlikes into incoming for view-all too
        const incomingNotMatched = myLikedByIds.filter(id => !myLikedIdsSet.has(id) && !myMatchesIdsSet.has(id));
        const superNotMatched = mySuperLikedByIds.filter(id => !myMatchesIdsSet.has(id));
        
        // Remove duplicates and filter blocked
        targetIds = [...new Set([...incomingNotMatched, ...superNotMatched])].filter(id => 
          !myDislikedIdsSet.has(id) && !myBlockedIdsSet.has(id)
        );
      } 
      // Sent likes removed from dashboard/view-all logic as per user request

      targetIds.reverse();

      // --- Quantity-based Stickiness Logic ---
      const revealLimit = getMatchListLimit(userPlan, type);
      let revealedIds = [];

      if (revealLimit === Infinity) {
        revealedIds = targetIds;
      } else {
        // Check for stickiness cache (24h)
        const revealCacheKey = `reveal_set_${type}_${currentUserId}`;
        const cachedReveals = await getMatchesCache(currentUserId, revealCacheKey);

        if (cachedReveals && Array.isArray(cachedReveals)) {
          // Use cached IDs, but filter they still exist in targetIds (not unliked/blocked since)
          const targetIdsSet = new Set(targetIds);
          revealedIds = cachedReveals.filter(id => targetIdsSet.has(id));
          
          // If the cached set is smaller than the limit (new likes came in), we keep the old ones 
          // to maintain stickiness, but we don't automatically add new ones until 24h is up
          // unless they are empty.
        } else {
          // Pick fresh N IDs
          revealedIds = targetIds.slice(0, revealLimit);
          await setMatchesCache(currentUserId, revealCacheKey, revealedIds, 86400); // 24 Hours
        }
      }

      const totalUsers = targetIds.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedIds = targetIds.slice(startIndex, startIndex + limitNum);

      const usersData = await User.find({ _id: { $in: paginatedIds } })
        .select("name avatar bio location birthday interests gender isVerified subscription dna")
        .lean();

      const revealedIdsSet = new Set(revealedIds);

      let processedUsers = usersData.map((matchUser) => {
        const userIdStr = matchUser._id.toString();
        const matchScore = calculateCompatibility(user, matchUser);
        const isSuper = mySuperLikedByIdsSet.has(userIdStr);
        
        const isRevealed = revealedIdsSet.has(userIdStr) || revealLimit === Infinity;
        const isLocked = !isRevealed;

        let finalData = { ...matchUser };

        if (isLocked) {
          finalData.name = "Someone";
          finalData.avatar = "/locked-avatar.png";
          finalData.bio = "";
          // Remove sensitive fields
          delete finalData.location;
          delete finalData.interests;
          delete finalData.dna;
          delete finalData.gallery;
        }

        return {
          ...finalData,
          matchScore,
          engagementType: isSuper ? "super" : "like",
          isLocked
        };
      });

      processedUsers.sort((a, b) => {
          return paginatedIds.indexOf(a._id.toString()) - paginatedIds.indexOf(b._id.toString());
      });

      const result = {
        users: processedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
        revealCount: revealedIds.length,
        totalIncomingCount: totalUsers
      };
      
      await setMatchesCache(currentUserId, type, result, 600);
      return res.status(200).json(result);
    }

    else {
      // 1. Mutual Matches Preview
      let mutualIds = myMatchesIds.length > 0 
        ? myMatchesIds.filter(id => !myDislikedIdsSet.has(id)).reverse()
        : myLikedIds.filter(id => myLikedByIdsSet.has(id) && !myDislikedIdsSet.has(id)).reverse();
      
      // 2. Combined Incoming & SuperLikes Preview
      const incomingNotMatched = myLikedByIds.filter(id => !myLikedIdsSet.has(id) && !myMatchesIdsSet.has(id));
      const superNotMatched = mySuperLikedByIds.filter(id => !myMatchesIdsSet.has(id));
      let combinedIncomingIds = [...new Set([...incomingNotMatched, ...superNotMatched])].reverse();
      
      const previewLimit = 20;
      const mutualPreviewIds = mutualIds.slice(0, previewLimit);
      const incomingPreviewIds = combinedIncomingIds.slice(0, previewLimit);

      const allPreviewIds = [...new Set([...mutualPreviewIds, ...incomingPreviewIds])];

      const usersData = await User.find({ _id: { $in: allPreviewIds } })
        .select("name avatar bio location birthday matchScore interests gender isVerified subscription dna")
        .lean();

      const enrichUsers = (idList, typeName = "mutual") => {
        const revealLimit = getMatchListLimit(userPlan, typeName);
        // For preview dashboard, we don't necessarily need the stickiness cache for the first view-all request, 
        // but it's better to be consistent. 
        // For simplicity in the preview, we'll just slice.
        
        return idList.map((id, index) => {
          const matchUser = usersData.find(u => u._id.toString() === id);
          if (!matchUser) return null;
          
          const matchScore = calculateCompatibility(user, matchUser);
          const isSuper = mySuperLikedByIdsSet.has(id);
          
          const isRevealed = (typeName === "mutual") || (index < revealLimit);
          const isLocked = !isRevealed;

          let finalData = { ...matchUser };

          if (isLocked) {
              finalData.name = "Someone";
              finalData.avatar = "/locked-avatar.png";
              finalData.bio = "";
              delete finalData.location;
              delete finalData.interests;
              delete finalData.dna;
          }

          return {
            ...finalData,
            matchScore,
            engagementType: isSuper ? "super" : "like",
            isLocked
          };
        }).filter(u => u !== null);
      };

      const dashboardData = {
        mutualMatches: enrichUsers(mutualPreviewIds, "mutual"),
        incomingLikes: enrichUsers(incomingPreviewIds, "incoming"),
      };
      await setMatchesCache(currentUserId, "matches_dashboard", dashboardData, 300);
      return res.status(200).json(dashboardData);
    }

  } catch (error) {
    console.error("Get Matches Dashboard Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

const INSIGHTS_CACHE_TTL = 300; // 5 min

export const getMatchInsights = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const myId = req.user.userId || req.user.id;
    const cacheKey = `insights_${targetUserId}`;
    const cached = await getMatchesCache(myId, cacheKey);
    if (cached) return res.status(200).json(cached);

    const me = await User.findById(myId).select("interests questionsbycategoriesResults location dna");
    const other = await User.findById(targetUserId).select("name avatar interests questionsbycategoriesResults location dna");

    if (!me || !other) {
      return res.status(404).json({ message: "User not found" });
    }

    const score = calculateCompatibility(me, other);
    const insights = generateMatchInsights(me, other);

    const payload = {
      targetUser: {
        name: other.name,
        avatar: other.avatar
      },
      matchScore: score,
      dna: insights.dnaComparison.other, // Add flat DNA for frontend SwipeCard
      ...insights
    };
    await setMatchesCache(myId, cacheKey, payload, INSIGHTS_CACHE_TTL);
    res.status(200).json(payload);
  } catch (error) {
    console.error("Insights Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? "Server error. Please try again later."
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};