import logger from "../utils/logger.js";
import User from "../models/User.js";
import { getSoulmatePermissions } from "../utils/subscriptionRules.js";
import redisClient from "../config/redis.js";

// 1. Load More Near You (Same City)
export async function loadMoreNearYou(userId, page = 1, limit = 20) {
  try {
    const currentUser = await User.findById(userId)
      .select("location lookingFor likedUsers dislikedUsers matches blockedUsers")
      .lean();

    if (!currentUser) throw new Error("User not found");

    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const skip = (page - 1) * limit;

    const query = {
      _id: { $nin: excludedIds },
      "location.city": currentUser.location?.city,
      "location.country": currentUser.location?.country
    };

    if (currentUser.lookingFor) {
      query.gender = currentUser.lookingFor;
    }

    const [users, totalCount] = await Promise.all([
      User.find(query)
        .select("_id name avatar birthday verification.status")
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    return {
      users,
      hasMore: skip + users.length < totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount
    };
  } catch (error) {
    logger.error("[loadMoreNearYou] Error:", error);
    throw error;
  }
}

// 2. Load More Fresh Faces (Recently Joined)
export async function loadMoreFreshFaces(userId, page = 1, limit = 20) {
  try {
    const currentUser = await User.findById(userId)
      .select("location lookingFor likedUsers dislikedUsers matches blockedUsers")
      .lean();

    if (!currentUser) throw new Error("User not found");

    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const skip = (page - 1) * limit;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const query = {
      _id: { $nin: excludedIds },
      "location.country": currentUser.location?.country,
      createdAt: { $gte: thirtyDaysAgo }
    };

    if (currentUser.lookingFor) {
      query.gender = currentUser.lookingFor;
    }

    const [users, totalCount] = await Promise.all([
      User.find(query)
        .select("_id name avatar birthday verification.status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    return {
      users,
      hasMore: skip + users.length < totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount
    };
  } catch (error) {
    logger.error("[loadMoreFreshFaces] Error:", error);
    throw error;
  }
}

// 3. Load More Across the Country (Different Cities)
export async function loadMoreAcrossCountry(userId, page = 1, limit = 20) {
  try {
    const currentUser = await User.findById(userId)
      .select("location lookingFor likedUsers dislikedUsers matches blockedUsers")
      .lean();

    if (!currentUser) throw new Error("User not found");

    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const skip = (page - 1) * limit;

    const query = {
      _id: { $nin: excludedIds },
      "location.country": currentUser.location?.country
    };

    if (currentUser.lookingFor) {
      query.gender = currentUser.lookingFor;
    }

    const [users, totalCount] = await Promise.all([
      User.find(query)
        .select("_id name avatar birthday verification.status")
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    return {
      users,
      hasMore: skip + users.length < totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount
    };
  } catch (error) {
    logger.error("[loadMoreAcrossCountry] Error:", error);
    throw error;
  }
}

// 4. Load More Compatibility Vibes (Random)
export async function loadMoreCompatibilityVibes(userId, page = 1, limit = 20) {
  try {
    const currentUser = await User.findById(userId)
      .select("location lookingFor likedUsers dislikedUsers matches blockedUsers")
      .lean();

    if (!currentUser) throw new Error("User not found");

    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const query = {
      _id: { $nin: excludedIds },
      "location.country": currentUser.location?.country
    };

    if (currentUser.lookingFor) {
      query.gender = currentUser.lookingFor;
    }

    const skip = (page - 1) * limit;
    
    const users = await User.aggregate([
      { $match: query },
      { $sample: { size: limit * 2 } }, 
      {
        $project: {
          _id: 1,
          name: 1,
          avatar: 1,
          birthday: 1,
          "verification.status": 1
        }
      },
      { $limit: limit }
    ]);

    const totalCount = await User.countDocuments(query);

    return {
      users,
      hasMore: skip + users.length < totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount
    };
  } catch (error) {
    logger.error("[loadMoreCompatibilityVibes] Error:", error);
    throw error;
  }
}

// 5. Load More Soulmates — reads pre-computed list
// ✅ Zero calculateCompatibility calls at request time!
export async function loadMoreSoulmates(userId, page = 1, limit = 10, userPlan = "free") {
  try {
    // 1. Gate: FREE plan users cannot see soulmates
    const { isLocked, limit: planLimit } = getSoulmatePermissions(userPlan);
    if (isLocked) {
      throw new Error("Premium subscription required for Soulmates");
    }

    // 2. Try Redis cache first (TTL: 7 days)
    const cacheKey = `soulmates:${userId}`;

    let list = null;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) list = JSON.parse(cached);
    } catch { /* Redis miss — fall through */ }

    // 3. If not in Redis, read from MongoDB
    if (!list) {
      const me = await User.findById(userId)
        .select("soulmateMatches potentialMatches subscription location lookingFor")
        .lean();

      if (!me) throw new Error("User not found");

      const computed = me.soulmateMatches;
      const hasValidList = computed?.list?.length > 0 && computed?.calculatedAt;

      if (hasValidList) {
        list = computed.list;
        redisClient.setEx(cacheKey, 7 * 24 * 3600, JSON.stringify(list)).catch(() => {});
      } else {
        logger.info(`[Soulmates] ⚡ No pre-computed list for ${userId}. Relying on potentialMatches fallback...`);
        
        // Fallback to potentialMatches if soulmateMatches hasn't been generated by worker yet
        list = (me.potentialMatches || [])
          .filter(m => m.matchScore >= 90)
          .map(m => ({ user: m.user, score: m.matchScore }))
          .sort((a, b) => b.score - a.score)
          .slice(0, planLimit === Infinity ? 40 : planLimit);
        
        if (list.length > 0) {
            redisClient.setEx(cacheKey, 7 * 24 * 3600, JSON.stringify(list)).catch(() => {});
        }
      }
    }

    // 5. Apply plan limit
    const cap = planLimit === Infinity ? list.length : planLimit;
    const limitedList = list.slice(0, cap);

    // 6. Paginate
    const skip = (page - 1) * limit;
    const pageSlice = limitedList.slice(skip, skip + limit);

    if (!pageSlice.length) {
      return { users: [], hasMore: false, totalCount: limitedList.length, currentPage: page, totalPages: Math.ceil(limitedList.length / limit), planLimit };
    }

    // 7. Fetch FULL profiles with MINIMALIST projection
    const userIds = pageSlice.map((m) => m.user);
    const users = await User.find({ _id: { $in: userIds } })
      .select("_id name avatar birthday verification.status")
      .lean();

    // 8. Attach score + preserve order
    const scoreMap = new Map(pageSlice.map((m) => [m.user.toString(), m.score]));
    const orderedUsers = userIds
      .map((id) => {
        const u = users.find((u) => u._id.toString() === id.toString());
        if (!u) return null;
        return { ...u, matchScore: scoreMap.get(id.toString()) };
      })
      .filter(Boolean);

    return {
      users: orderedUsers,
      hasMore: skip + limit < limitedList.length,
      totalPages: Math.ceil(limitedList.length / limit),
      currentPage: page,
      totalCount: limitedList.length,
      planLimit,
    };

  } catch (error) {
    logger.error("[loadMoreSoulmates] Error:", error);
    throw error;
  }
}
