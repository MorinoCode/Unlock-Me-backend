import User from "../../models/User.js";
import {
  calculateCompatibility,
  calculateUserDNA,
  getVisibilityThreshold,
  generateMatchInsights,
} from "../../utils/matchUtils.js";
import { getMatchesCache, setMatchesCache } from "../../utils/cacheHelper.js";
import {
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
  const { forceRefresh, category, page = 1, limit = 20 } = req.query;

  if (category) {
    try {
      return await handleCategoryPagination(req, res, category, page, limit);
    } catch (err) {
      console.error("Category Pagination Error:", err);
      return res.status(500).json({ message: "Failed to load category matches" });
    }
  }

  console.log(`\n========================================`);
  console.log(`[Explore] 📋 GET REQUEST for user: ${req.user.userId}`);
  console.log(`========================================`);
  
  try {
    console.log(`[Explore] ForceRefresh: ${!!forceRefresh}`);

    const cacheKey = `analysis:sections:${req.user.userId}`;
    console.log(`[Explore] Checking Redis cache: ${cacheKey}`);
    
    let sections;

    if (!forceRefresh) {
      const cachedSections = await redisClient.get(cacheKey);
      if (cachedSections) {
        sections = JSON.parse(cachedSections);
        console.log(`✅ [Explore] CACHE HIT! (${Date.now() - start}ms)`);
        res.set('X-Cache', 'HIT'); 
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

    const mappedSections = {
      cityMatches: sections.nearYou || [],
      freshFaces: sections.freshFaces || [],
      interestMatches: sections.compatibilityVibes || [],
      soulmates: null,
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
        requiresPlan: ["gold", "platinum", "diamond"]
      },
      cached: false 
    });

  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const handleCategoryPagination = async (req, res, category, page, limit) => {
  const categoryMap = {
    "nearby": "nearYou",
    "new": "freshFaces",
    "interests": "compatibilityVibes",
    "soulmates": "soulmates",
    "country": "acrossTheCountry"
  };

  const backendSection = categoryMap[category] || category;

  const { loadMoreSection: newLoadMoreSection } = await import("./loadMoreSection.js");
  
  req.body = { section: backendSection, page: parseInt(page), limit: parseInt(limit) };
  return newLoadMoreSection(req, res);
};

export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

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
    
    await setMatchesCache(currentUserId, `user_details_${userId}`, result, 300); // 5 minutes
    
    res.status(200).json(result);
  } catch (err) {
    console.error("User Details Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const refillExploreSection = async (req, res) => {
    try {
        const { section } = req.body; 
        const currentUserId = req.user.userId;

        if (!section) {
            return res.status(400).json({ message: "Section is required" });
        }

        console.log(`[Explore] Refill requested for section: ${section} by ${currentUserId}`);

        const me = await User.findById(currentUserId).select(
            "location interests lookingFor subscription potentialMatches matches likedUsers dislikedUsers"
        );

        if (!me) return res.status(404).json({ message: "User not found" });

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

        const candidateIds = newMatches.map(m => m.user);
        const candidates = await User.find({ _id: { $in: candidateIds } })
            .select("_id name avatar birthday verification.status")
            .lean();

        const finalResults = candidates.map(c => {
            const match = newMatches.find(m => m.user.toString() === c._id.toString());
            return {
                ...c,
                matchScore: match ? match.matchScore : 0
            };
        });

        if (section === "new" || section === "fresh_faces") {
             finalResults.sort((a, b) => b.matchScore - a.matchScore); // Sorting by date was removed from projection, so fallback to score
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
