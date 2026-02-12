import User from "../models/User.js";
import { getSoulmatePermissions } from "../utils/subscriptionRules.js";
import { calculateCompatibility } from "../utils/matchUtils.js";

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

// 5. Load More Soulmates (DNA Calculation + Subscription Limits)
export async function loadMoreSoulmates(userId, page = 1, limit = 20, userPlan = "free") {
  try {
    // Check subscription
    const { isLocked, limit: planLimit } = getSoulmatePermissions(userPlan);
    
    if (isLocked) {
      throw new Error("Premium subscription required for Soulmates");
    }

    const currentUser = await User.findById(userId)
      .select("location lookingFor dna likedUsers dislikedUsers matches blockedUsers questionsbycategoriesResults")
      .lean();

    if (!currentUser) throw new Error("User not found");
    if (!currentUser.dna) throw new Error("User DNA not calculated");

    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const query = {
      _id: { $nin: excludedIds },
      "location.country": currentUser.location?.country,
      dna: { $exists: true, $ne: null }
    };

    if (currentUser.lookingFor) {
      query.gender = currentUser.lookingFor;
    }

    // Fetch candidates for DNA calculation
    const candidates = await User.find(query)
      .select("name avatar bio location birthday gender interests isVerified createdAt dna questionsbycategoriesResults")
      .limit(500) // Fetch more for filtering
      .lean();

    // Calculate DNA compatibility
    const withScores = candidates.map(candidate => ({
      ...candidate,
      matchScore: calculateCompatibility(currentUser, candidate)
    }));

    // Filter > 90% match
    const soulmates = withScores
      .filter(u => u.matchScore > 90)
      .sort((a, b) => b.matchScore - a.matchScore);

    // Apply plan limit
    const limitedSoulmates = planLimit === Infinity 
      ? soulmates 
      : soulmates.slice(0, planLimit);

    // Pagination
    const skip = (page - 1) * limit;
    const paginatedUsers = limitedSoulmates.slice(skip, skip + limit);

    // Remove matchScore from response (keep it internal)
    const cleanUsers = paginatedUsers.map((u) => {
      const { matchScore: _, ...rest } = u; // eslint-disable-line no-unused-vars
      return rest;
    });

    return {
      users: cleanUsers,
      hasMore: skip + limit < limitedSoulmates.length,
      totalPages: Math.ceil(limitedSoulmates.length / limit),
      currentPage: page,
      totalCount: limitedSoulmates.length,
      planLimit
    };
  } catch (error) {
    console.error("[loadMoreSoulmates] Error:", error);
    throw error;
  }
}
