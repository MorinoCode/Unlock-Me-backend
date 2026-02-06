import User from "../../models/User.js";
import { calculateCompatibility, generateMatchInsights } from "../../utils/matchUtils.js";
import { getVisibilityThreshold } from "../../utils/subscriptionRules.js";
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
      .select("likedUsers likedBy matches superLikedBy dislikedUsers interests lookingFor gender location birthday questionsbycategoriesResults subscription")
      .lean();
      
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Bug Fix: Use matches array if available (more efficient)
    const myLikedIds = (user.likedUsers || []).map(id => id.toString());
    const myLikedByIds = (user.likedBy || []).map(id => id.toString());
    const myMatchesIds = (user.matches || []).map(id => id.toString());
    const mySuperLikedByIds = (user.superLikedBy || []).map(id => id.toString());
    const myDislikedIds = (user.dislikedUsers || []).map(id => id.toString());
    
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

      if (type === 'mutual') {
        // ✅ Performance Fix: Use matches array if available (much faster)
        // Mutual matches: users who liked each other (excluding disliked)
        targetIds = myMatchesIds.length > 0 
          ? myMatchesIds.filter(id => !myDislikedIds.includes(id))
          : myLikedIds.filter(id => myLikedByIds.includes(id) && !myDislikedIds.includes(id));
      } 
      else if (type === 'incoming') {
        // Incoming likes: users who liked me but I haven't liked back (excluding disliked and matches)
        targetIds = myLikedByIds.filter(id => 
          !myLikedIds.includes(id) && 
          !myMatchesIds.includes(id) && 
          !myDislikedIds.includes(id)
        );
      } 
      else if (type === 'sent') {
        // Sent likes: users I liked but they haven't liked back (excluding disliked and matches)
        targetIds = myLikedIds.filter(id => 
          !myLikedByIds.includes(id) && 
          !myMatchesIds.includes(id) && 
          !myDislikedIds.includes(id)
        );
      }
      else if (type === 'superlikes') {
        // Super Likes received (excluding matches and disliked)
        targetIds = mySuperLikedByIds.filter(id => 
          !myMatchesIds.includes(id) && 
          !myDislikedIds.includes(id)
        );
      }

      targetIds.reverse();

      const totalUsers = targetIds.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedIds = targetIds.slice(startIndex, startIndex + limitNum);

      // ✅ Performance Fix: Batch query with all needed fields
      const usersData = await User.find({ _id: { $in: paginatedIds } })
        .select("name avatar bio location birthday interests gender isVerified subscription dna")
        .lean();

      // ✅ Performance Fix: Batch compatibility calculation (more efficient)
      let processedUsers = usersData.map(matchUser => {
        const matchScore = calculateCompatibility(user, matchUser);
        const isLocked = matchScore > visibilityThreshold;
        return {
          ...matchUser,
          matchScore,
          isLocked // Apply visibility threshold
        };
      });

      processedUsers.sort((a, b) => {
          return paginatedIds.indexOf(a._id.toString()) - paginatedIds.indexOf(b._id.toString());
      });

      const result = {
        users: processedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers }
      };
      
      // ✅ Performance Fix: Cache the result
      await setMatchesCache(currentUserId, type, result, 600); // 10 minutes
      
      return res.status(200).json(result);
    }

    else {
      // ✅ Performance Fix: Use matches array for mutual matches
      // Mutual matches: users who liked each other (excluding disliked)
      let mutualIds = myMatchesIds.length > 0 
        ? myMatchesIds.filter(id => !myDislikedIds.includes(id)).reverse()
        : myLikedIds.filter(id => myLikedByIds.includes(id) && !myDislikedIds.includes(id)).reverse();
      
      // Sent likes: users I liked but they haven't liked back (excluding disliked and matches)
      let sentIds = myLikedIds.filter(id => 
        !myLikedByIds.includes(id) && 
        !myMatchesIds.includes(id) && 
        !myDislikedIds.includes(id)
      ).reverse();
      
      // Incoming likes: users who liked me but I haven't liked back (excluding disliked and matches)
      let incomingIds = myLikedByIds.filter(id => 
        !myLikedIds.includes(id) && 
        !myMatchesIds.includes(id) && 
        !myDislikedIds.includes(id)
      ).reverse();
      
      // Super Likes received (excluding matches and disliked)
      let superLikeIds = mySuperLikedByIds.filter(id => 
        !myMatchesIds.includes(id) && 
        !myDislikedIds.includes(id)
      ).reverse();

      const previewLimit = 20;
      const mutualPreviewIds = mutualIds.slice(0, previewLimit);
      const sentPreviewIds = sentIds.slice(0, previewLimit);
      const incomingPreviewIds = incomingIds.slice(0, previewLimit);
      const superLikePreviewIds = superLikeIds.slice(0, previewLimit);

      const allPreviewIds = [...new Set([...mutualPreviewIds, ...sentPreviewIds, ...incomingPreviewIds, ...superLikePreviewIds])];

      const usersData = await User.find({ _id: { $in: allPreviewIds } })
        .select("name avatar bio location birthday matchScore interests gender isVerified subscription dna")
        .lean();

      const enrichUsers = (idList) => {
        return idList.map(id => {
          const matchUser = usersData.find(u => u._id.toString() === id);
          if (!matchUser) return null;
          const matchScore = calculateCompatibility(user, matchUser);
          const isLocked = matchScore > visibilityThreshold;
          return {
            ...matchUser,
            matchScore,
            isLocked // Apply visibility threshold
          };
        }).filter(u => u !== null);
      };

      const dashboardData = {
        mutualMatches: enrichUsers(mutualPreviewIds),
        sentLikes: enrichUsers(sentPreviewIds),
        incomingLikes: enrichUsers(incomingPreviewIds),
        superLikes: enrichUsers(superLikePreviewIds)
      };
      await setMatchesCache(currentUserId, "matches_dashboard", dashboardData, 300); // 5 min
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

    const me = await User.findById(myId).select("interests questionsbycategoriesResults location");
    const other = await User.findById(targetUserId).select("name avatar interests questionsbycategoriesResults location");

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