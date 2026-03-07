import User from "../models/User.js";
import { getSoulmatePermissions } from "../utils/subscriptionRules.js";
import { calculateCompatibility } from "../utils/matchUtils.js";
import redisClient from "../config/redis.js";

// ✅ Pagination Workers for "See More" Pages

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
        .select("name avatar bio location birthday gender interests isVerified createdAt")
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
    console.error("[loadMoreNearYou] Error:", error);
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
        .select("name avatar bio location birthday gender interests isVerified createdAt")
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
    console.error("[loadMoreFreshFaces] Error:", error);
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
        .select("name avatar bio location birthday gender interests isVerified createdAt")
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
    console.error("[loadMoreAcrossCountry] Error:", error);
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

    // For random, we use aggregation with $sample
    const skip = (page - 1) * limit;
    
    const users = await User.aggregate([
      { $match: query },
      { $sample: { size: limit * 2 } }, // Get more for randomness
      {
        $project: {
          name: 1,
          avatar: 1,
          bio: 1,
          location: 1,
          birthday: 1,
          gender: 1,
          interests: 1,
          isVerified: 1,
          createdAt: 1
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
    console.error("[loadMoreCompatibilityVibes] Error:", error);
    throw error;
  }
}

// 5. Load More Soulmates — reads pre-computed list (soulmateWorker.js feeds this)
// ✅ Zero calculateCompatibility calls at request time
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
        .select("soulmateMatches subscription location lookingFor dna matches likedUsers dislikedUsers blockedUsers questionsbycategoriesResults")
        .lean();

      if (!me) throw new Error("User not found");

      const computed = me.soulmateMatches;
      const hasValidList = computed?.list?.length > 0 && computed?.calculatedAt;

      if (hasValidList) {
        // ✅ Use pre-computed list — no calculation needed
        list = computed.list;

        // Cache in Redis for 7 days
        redisClient.setEx(cacheKey, 7 * 24 * 3600, JSON.stringify(list)).catch(() => {});

      } else {
        // 4. Fallback: list not yet computed — run a one-time sync computation
        // This only happens on first ever access (before worker has run)
        console.log(`[Soulmates] ⚡ No pre-computed list for ${userId}. Running one-time sync...`);

        const plan = userPlan.toLowerCase();
        const fetchSize = (plan === "gold" ? 50 : plan === "platinum" ? 100 : 200);

        const excludedIds = [
          me._id,
          ...(me.matches       || []),
          ...(me.likedUsers    || []),
          ...(me.dislikedUsers || []),
          ...(me.blockedUsers  || []),
        ];

        const query = {
          _id:                { $nin: excludedIds },
          "location.country": me.location?.country,
          dna:                { $exists: true, $ne: null },
          "dna.Logic":        { $exists: true, $type: "number" },
        };
        if (me.lookingFor) query.gender = me.lookingFor;

        const candidates = await User.find(query)
          .select("dna questionsbycategoriesResults interests location gender birthday")
          .limit(fetchSize)
          .lean();

        const scored = candidates
          .map((c) => ({ user: c._id, score: calculateCompatibility(me, c) }))
          .filter((c) => c.score >= 90)
          .sort((a, b) => b.score - a.score)
          .slice(0, planLimit === Infinity ? 40 : planLimit);

        list = scored;

        // Persist to MongoDB so worker doesn't need to run first
        User.findByIdAndUpdate(userId, {
          $set: {
            "soulmateMatches.list":         scored,
            "soulmateMatches.calculatedAt": new Date(),
          },
        }).catch(() => {});

        // Cache in Redis
        redisClient.setEx(cacheKey, 7 * 24 * 3600, JSON.stringify(list)).catch(() => {});
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

    // 7. Fetch full user profiles for the page slice only
    const userIds = pageSlice.map((m) => m.user);
    const users = await User.find({ _id: { $in: userIds } })
      .select("name avatar bio location birthday gender interests isVerified createdAt")
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
    console.error("[loadMoreSoulmates] Error:", error);
    throw error;
  }
}
