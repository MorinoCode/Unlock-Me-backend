import User from "../../models/User.js";
import {
  calculateCompatibility,
  calculateUserDNA,
  shuffleArray,
  generateMatchInsights,
  getVisibilityThreshold,
  getSoulmatePermissions,
  escapeRegex,
} from "../../utils/matchUtils.js";
import { getMatchesCache, setMatchesCache } from "../../utils/cacheHelper.js";
import {
  getCompatibilityScore,
  setCompatibilityScore,
  getFromPotentialPoolPaginated,
  getCompatibilityScoreBatch,
  batchSetCompatibilityScores,
  REDIS_PREFIXES
} from "../../utils/redisMatchHelper.js";
import redisClient from "../../config/redis.js";
import { findMatchesForSection } from "../../workers/exploreMatchWorker.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Get User Location Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getExploreMatches = async (req, res) => {
  const start = Date.now();
  const { forceRefresh, category, page = 1, limit = 20 } = req.query; // Added category, page, limit

  // ✅ CASE 1: View All / Category Pagination
  if (category) {
    try {
      return await handleCategoryPagination(req, res, category, page, limit);
    } catch (err) {
      console.error("Category Pagination Error:", err);
      return res.status(500).json({ message: "Failed to load category matches" });
    }
  }

  // ✅ CASE 2: Main Explore Page (All Sections)
  console.log(`\n========================================`);
  console.log(`[Explore] 📋 GET REQUEST for user: ${req.user.userId}`);
  console.log(`========================================`);
  
  try {
    const currentUserId = req.user.userId;

    console.log(`[Explore] ForceRefresh: ${!!forceRefresh}`);

    // ✅ NEW: Check Redis for 5-section data
    const cacheKey = `analysis:sections:${req.user.userId}`;
    console.log(`[Explore] Checking Redis cache: ${cacheKey}`);
    
    let sections;

    if (!forceRefresh) {
      const cachedSections = await redisClient.get(cacheKey);
      if (cachedSections) {
        sections = JSON.parse(cachedSections);
        console.log(`✅ [Explore] CACHE HIT! (${Date.now() - start}ms)`);
        res.set('X-Cache', 'HIT'); // ✅ Checkable in Browser Network Tab
      } else {
        console.log(`⚠️ [Explore] CACHE MISS! Generating fresh data...`);
        res.set('X-Cache', 'MISS');
      }
    }

    if (!sections) {
      console.log(`[Explore] Triggering generateAnalysisData worker...`);
      const { generateAnalysisData } = await import("../../workers/exploreMatchWorker.js");
      sections = await generateAnalysisData(req.user.userId);
    }

    if (!sections) {
      return res.status(200).json({
        mode: "sections",
        sections: {
          cityMatches: [],
          freshFaces: [],
          interestMatches: [],
          soulmates: [],
          countryMatches: []
        },
        message: "No matches found."
      });
    }

    // ✅ MAP BACKEND KEYS TO FRONTEND KEYS
    const mappedSections = {
      cityMatches: sections.nearYou || [],
      freshFaces: sections.freshFaces || [],
      interestMatches: sections.compatibilityVibes || [],
      soulmates: null, // Special box (no users)
      countryMatches: sections.acrossTheCountry || []
    };

    console.log(`✅ [Explore] Returning Mapped Sections (${Date.now() - start}ms)`);
    console.log(`========================================\n`);

    return res.status(200).json({
      mode: "sections",
      sections: mappedSections,
      soulmatesMetadata: {
        description: "Soulmates are users with over 90% DNA match",
        isPremiumFeature: true,
        requiresPlan: ["gold", "platinum"]
      },
      cached: false // Simplified
    });

  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Helper for Category Pagination
const handleCategoryPagination = async (req, res, category, page, limit) => {
  // Map frontend category to backend section key
  const categoryMap = {
    "nearby": "nearYou",
    "new": "freshFaces",
    "interests": "compatibilityVibes",
    "soulmates": "soulmates",
    "country": "acrossTheCountry"
  };

  const backendSection = categoryMap[category] || category;

  // ✅ Use new loadMoreSection from loadMoreSection.js
  const { loadMoreSection: newLoadMoreSection } = await import("./loadMoreSection.js");
  
  // Mock req.body for the new controller
  req.body = { section: backendSection, page: parseInt(page), limit: parseInt(limit) };
  return newLoadMoreSection(req, res);
};

// ✅ NEW: Load More Section (150/page pagination)
export const loadMoreSection = async (req, res) => {
  try {
    const { section, page = 1 } = req.body;
    const currentUserId = req.user.userId;
    const LIMIT = 150;

    console.log(`\n========================================`);
    console.log(`[Explore] 📄 LOAD MORE: section=${section}, page=${page}`);
    console.log(`[Explore] User: ${currentUserId}`);
    console.log(`========================================`);

    if (!section) {
      console.error(`❌ [LoadMore] Section parameter missing!`);
      return res.status(400).json({ message: "Section is required" });
    }

    const me = await User.findById(currentUserId).select(
      "location lookingFor dna birthday interests gender likedUsers dislikedUsers matches blockedUsers"
    ).lean();

    if (!me) return res.status(404).json({ message: "User not found" });

    // Get exclusion history from Redis
    const historyKey = `explore:history:${currentUserId}:${section}`;
    const seenIdsSet = await redisClient.sMembers(historyKey);
    const seenIds = [...seenIdsSet, currentUserId.toString()];

    // Build section-specific query
    let query = {
      _id: { $nin: seenIds },
      "location.country": me.location?.country,
      dna: { $exists: true, $ne: null }
    };

    if (me.lookingFor) {
      query.gender = me.lookingFor;
    }

    // Section-specific filters
    if (section === "nearYou" && me.location?.city) {
      query["location.city"] = me.location.city;
    } else if (section === "freshFaces") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: thirtyDaysAgo };
    }

    console.log(`[LoadMore] Query:`, JSON.stringify(query));
    console.log(`[LoadMore] Fetching ${LIMIT} users (skip: ${(page - 1) * LIMIT})...`);

    // Fetch 150 users
    const users = await User.find(query)
      .select("name avatar bio location birthday gender interests dna isVerified createdAt questionsbycategoriesResults")
      .limit(LIMIT)
      .skip((page - 1) * LIMIT)
      .lean();

    console.log(`✅ [LoadMore] Fetched ${users.length} users from DB`);


    // Calculate scores
    const scoredUsers = users.map(u => ({
      ...u,
      matchScore: calculateCompatibility(me, u)
    }));

    // Apply section-specific sorting/filtering
    let filteredUsers = scoredUsers;
    if (section === "compatibilityVibes") {
      filteredUsers = scoredUsers.filter(u => u.matchScore >= 70 && u.matchScore < 90);
    } else if (section === "theSoulmates") {
      filteredUsers = scoredUsers.filter(u => u.matchScore >= 90);
    }

    // Sort
    if (section === "freshFaces") {
      filteredUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      filteredUsers.sort((a, b) => b.matchScore - a.matchScore);
    }

    // Add to history
    const userIds = filteredUsers.map(u => u._id.toString());
    if (userIds.length > 0) {
      await redisClient.sAdd(historyKey, userIds);
      await redisClient.expire(historyKey, 24 * 60 * 60); // 24h TTL
    }

    console.log(`✅ [LoadMore] Returning ${filteredUsers.length} users (hasMore: ${users.length === LIMIT})`);
    console.log(`========================================\n`);

    return res.status(200).json({
      users: filteredUsers,
      hasMore: users.length === LIMIT,
      currentPage: page,
      section
    });

  } catch (err) {
    console.error(`\n❌ [LoadMore] FATAL ERROR:`);
    console.error(err);
    console.error(`========================================\n`);
    res.status(500).json({ message: "Failed to load more users." });
  }
};

export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    // ✅ Performance Fix: Try cache first
    const cacheKey = `user_details_${userId}`;
    const cached = await getMatchesCache(currentUserId, cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const me = await User.findById(currentUserId).select(
      "potentialMatches interests location dna lookingFor subscription gender birthday"
    );

    const userPlan = me.subscription?.plan || "free";
    const visibilityLimit = getVisibilityThreshold(userPlan);

    const cachedMatch = me.potentialMatches?.find(
      (m) => m.user.toString() === targetUser._id.toString()
    );

    let score;
    if (cachedMatch && cachedMatch.matchScore > 0) {
      score = cachedMatch.matchScore;
    } else {
      score = calculateCompatibility(me, targetUser);
    }

    const isLocked = score > visibilityLimit;
    
    // Only calculate expensive insights if not locked
    const dna = calculateUserDNA(targetUser);
    const insights = isLocked ? null : generateMatchInsights(me, targetUser);

    const result = {
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights,
      isLocked: isLocked, 
    };
    
    // ✅ Performance Fix: Cache the result
    await setMatchesCache(currentUserId, `user_details_${userId}`, result, 300); // 5 minutes
    
    res.status(200).json(result);
  } catch (err) {
    console.error("User Details Error:", err);
    // ✅ Security Fix: Don't expose error details
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

// ✅ NEW: Explore Refill Endpoint
export const refillExploreSection = async (req, res) => {
    try {
        const { section } = req.body; // e.g., "nearby", "fresh_faces", "soulmates", "common", "new", "country"
        const currentUserId = req.user.userId;

        if (!section) {
            return res.status(400).json({ message: "Section is required" });
        }

        console.log(`[Explore] Refill requested for section: ${section} by ${currentUserId}`);

        const me = await User.findById(currentUserId).select(
            "location interests lookingFor subscription potentialMatches matches likedUsers dislikedUsers"
        );

        if (!me) return res.status(404).json({ message: "User not found" });

        // Call Worker Logic (Fetch 50 new candidates)
        const newMatches = await findMatchesForSection(me, section, 50);

        if (!newMatches || newMatches.length === 0) {
            return res.status(200).json({
                success: true,
                section,
                count: 0,
                message: "No new matches found for this section.",
                users: []
            });
        }

        // Fetch Full Details for Frontend
        const candidateIds = newMatches.map(m => m.user);
        const candidates = await User.find({ _id: { $in: candidateIds } })
            .select("name avatar bio interests location birthday subscription gender createdAt isVerified dna")
            .lean();

        // Merge scores & Format
        const finalResults = candidates.map(c => {
            const match = newMatches.find(m => m.user.toString() === c._id.toString());
            return {
                ...c,
                matchScore: match ? match.matchScore : 0
            };
        });

        // Sort based on section logic or score
        if (section === "new" || section === "fresh_faces") {
             finalResults.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
             finalResults.sort((a, b) => b.matchScore - a.matchScore);
        }

        return res.status(200).json({
            success: true,
            section,
            count: finalResults.length,
            users: finalResults
        });

    } catch (err) {
        console.error("Explore Refill Error:", err);
        res.status(500).json({ message: "Refill failed." });
    }
};