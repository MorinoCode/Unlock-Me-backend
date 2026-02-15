import User from "../models/User.js";
import { setPotentialMatchesPool, batchSetCompatibilityScores } from "../utils/redisMatchHelper.js";
import { calculateCompatibility } from "../utils/matchUtils.js";
import redisClient from "../config/redis.js";

const CANDIDATE_LIMIT = 500; // For legacy findMatchesForUser
const STORE_LIMIT = 200; // Store top 200 matches


// Main Worker Function

// ✅ NEW: On-Demand Analysis Data Generator (150 fetch, 5 sections)
export async function generateAnalysisData(userId) {
  try {
    console.log(`\n========================================`);
    console.log(`[AnalysisWorker] 🚀 STARTING for user: ${userId}`);
    console.log(`========================================`);
    const startTime = Date.now();

    console.log(`[AnalysisWorker] Step 1: Fetching user data...`);
    const currentUser = await User.findById(userId)
      .select("location lookingFor dna birthday interests gender questionsbycategoriesResults likedUsers dislikedUsers matches blockedUsers")
      .lean();

    if (!currentUser) {
      console.error(`❌ [AnalysisWorker] User ${userId} NOT FOUND in database!`);
      return null;
    }

    console.log(`[AnalysisWorker] User found: ${currentUser._id}`);
    console.log(`[AnalysisWorker] Location: ${JSON.stringify(currentUser.location)}`);
    console.log(`[AnalysisWorker] LookingFor: ${currentUser.lookingFor}`);

    let userCountry = currentUser.location?.country;
    if (!userCountry) {
        console.warn(`⚠️ [AnalysisWorker] User ${userId} has NO COUNTRY. Defaulting to 'World'.`);
        userCountry = "World";
        // Optional: Update user record so next time it is correct
        // await User.findByIdAndUpdate(userId, { "location.country": "World", "location.city": "Global" });
    }

    // Build exclusion list
    const excludedIds = [
      userId,
      ...(currentUser.matches || []),
      ...(currentUser.likedUsers || []),
      ...(currentUser.dislikedUsers || []),
      ...(currentUser.blockedUsers || [])
    ];

    const SECTION_SIZE = 20;
    
    // Base query for all sections
    const baseQuery = {
      _id: { $nin: excludedIds },
      "location.country": userCountry
    };

    if (currentUser.lookingFor) {
      baseQuery.gender = currentUser.lookingFor;
    }

    const projection = {
      name: 1,
      avatar: 1,
      bio: 1,
      location: 1,
      birthday: 1,
      gender: 1,
      interests: 1,
      isVerified: 1,
      createdAt: 1
    };

    console.log(`[AnalysisWorker] 🔍 Fetching candidates for all sections...`);
    console.log(`   - Base Query: Country=${userCountry}, LookingFor=${currentUser.lookingFor || "Any"}`);

    // ✅ SEPARATE QUERIES FOR EACH SECTION (No overlap, better distribution)
    
    // 1. Near You - Same City
    const nearYouQuery = {
      ...baseQuery,
      "location.city": currentUser.location?.city
    };
    
    console.log(`[AnalysisWorker] SECTION 1: Near You (City: ${currentUser.location?.city})...`);
    const nearYou = await User.aggregate([
      { $match: nearYouQuery },
      { $sample: { size: SECTION_SIZE } },
      { $project: projection }
    ]);
    console.log(`   - Found: ${nearYou.length} users near you.`);

    // Exclude Near You users from other sections
    const nearYouIds = nearYou.map(u => u._id);
    const excludedWithNearYou = [...excludedIds, ...nearYouIds];

    // 2. Fresh Faces - Recently Joined (exclude Near You)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const freshFacesQuery = {
      ...baseQuery,
      _id: { $nin: excludedWithNearYou },
      createdAt: { $gte: thirtyDaysAgo }
    };
    
    console.log(`[AnalysisWorker] SECTION 2: Fresh Faces (Since: ${thirtyDaysAgo.toISOString().split('T')[0]})...`);
    const freshFaces = await User.aggregate([
      { $match: freshFacesQuery },
      { $sort: { createdAt: -1 } },
      { $limit: SECTION_SIZE },
      { $project: projection }
    ]);
    console.log(`   - Found: ${freshFaces.length} new users.`);

    // Exclude Fresh Faces from remaining sections
    const freshFacesIds = freshFaces.map(u => u._id);
    const excludedWithFresh = [...excludedWithNearYou, ...freshFacesIds];

    // 3. Across the Country - Different Cities (exclude Near You + Fresh Faces)
    const acrossCountryQuery = {
      ...baseQuery,
      _id: { $nin: excludedWithFresh },
      "location.city": { $ne: currentUser.location?.city }
    };
    
    console.log(`[AnalysisWorker] SECTION 3: Across the Country (Excluding City: ${currentUser.location?.city})...`);
    const acrossTheCountry = await User.aggregate([
      { $match: acrossCountryQuery },
      { $sample: { size: SECTION_SIZE } },
      { $project: projection }
    ]);
    console.log(`   - Found: ${acrossTheCountry.length} users across the country.`);

    // Exclude Across Country from Compatibility Vibes
    const acrossCountryIds = acrossTheCountry.map(u => u._id);
    const excludedWithAcross = [...excludedWithFresh, ...acrossCountryIds];

    // 4. Compatibility Vibes - Random (exclude all previous)
    const compatibilityQuery = {
      ...baseQuery,
      _id: { $nin: excludedWithAcross }
    };
    
    console.log(`[AnalysisWorker] SECTION 4: Compatibility Vibes (Excluding previous)...`);
    const compatibilityVibes = await User.aggregate([
      { $match: compatibilityQuery },
      { $sample: { size: SECTION_SIZE } },
      { $project: projection }
    ]);
    console.log(`   - Found: ${compatibilityVibes.length} random compatibility candidates.`);

    console.log(`[AnalysisWorker] ✅ All sections processed.`);

    // Generate 5 sections (4 with users, 1 null)
    const sections = {
      nearYou,
      freshFaces,
      soulmates: null, // Special box (no users)
      compatibilityVibes,
      acrossTheCountry
    };

    console.log(`[AnalysisWorker] 📦 Storing results in Redis (Key: analysis:sections:${userId})`);
    console.log(`[AnalysisWorker] Sections generated (4 SEPARATE QUERIES):`);
    console.log(`  - nearYou: ${sections.nearYou.length} users`);
    console.log(`  - freshFaces: ${sections.freshFaces.length} users`);
    console.log(`  - soulmates: null (special box)`);
    console.log(`  - compatibilityVibes: ${sections.compatibilityVibes.length} users`);
    console.log(`  - acrossTheCountry: ${sections.acrossTheCountry.length} users`);

    // Store in Redis (3-min TTL)
    const cacheKey = `analysis:sections:${userId}`;
    await redisClient.set(
      cacheKey,
      JSON.stringify(sections),
      { EX: 360 } // 6 minutes
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [AnalysisWorker] SUCCESS! Data generated for ${userId} in ${duration}s`);
    console.log(`✅ [AnalysisWorker] Redis key: ${cacheKey} (TTL: 180s)`);
    console.log(`========================================\n`);

    return sections;

  } catch (error) {
    console.error(`\n❌ [AnalysisWorker] FATAL ERROR for ${userId}:`);
    console.error(error);
    console.error(`========================================\n`);
    return null; // Return null instead of throwing so calling worker can handle it gracefully
  }
}

// ❌ CRON SCHEDULE REMOVED - Now on-demand only


export async function findMatchesForUser(currentUser) {
  try {
    if (!currentUser.location || !currentUser.location.country) {
        await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
        return;
    }

    if (!currentUser.dna || typeof currentUser.dna !== 'object') {
        console.warn(`⚠️ User ${currentUser._id} has no DNA. Skipping.`);
        await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
        return;
    }

    // ✅ Exclusion List: Matches + Likes + Dislikes
    // ✅ Exclusion List: Matches + Likes + Dislikes
    const excludedIds = [
        currentUser._id,
        ...(currentUser.matches || []),
        ...(currentUser.likedUsers || []),
        ...(currentUser.dislikedUsers || [])
    ];

    let genderFilter = {};
    if (currentUser.lookingFor) {
        genderFilter = { gender: currentUser.lookingFor };
    }

    // ✅ OPTIMIZATION: Fetch 500 Random Candidates (Filtered)
    // Instead of scanning everyone, we sample 500 valid candidates
    const candidates = await User.aggregate([
      {
        $match: {
          _id: { $nin: excludedIds }, // Exclude history
          "location.country": currentUser.location.country,
          "dna": { $exists: true, $ne: null },
          "dna.Logic": { $exists: true, $type: "number" },
          ...genderFilter
        }
      },
      { $sample: { size: CANDIDATE_LIMIT } }, // Random 500
      {
        $project: {
          name: 1,
          avatar: 1,
          bio: 1,
          interests: 1,
          location: 1,
          birthday: 1,
          subscription: 1,
          gender: 1,
          createdAt: 1,
          isVerified: 1,
          dna: 1, // Need DNA for scoring
          questionsbycategoriesResults: 1
        }
      }
    ]);

    // ✅ Calculate Score for ONLY 500 candidates (Fast!)
    const formattedMatches = candidates.map(candidate => {
      const exactScore = calculateCompatibility(currentUser, candidate);
      return {
          user: candidate._id,
          matchScore: exactScore, 
          updatedAt: new Date()
      };
    });

    // Score Sort
    formattedMatches.sort((a, b) => b.matchScore - a.matchScore);

    // ✅ Top 200
    const topMatches = formattedMatches.slice(0, STORE_LIMIT);

    // Update User DB
    await User.updateOne(
        { _id: currentUser._id },
        { 
            $set: { 
                potentialMatches: topMatches,
                lastMatchCalculation: new Date()
            }
        }
    );

    // Redis Sync
    try {
        const scoresBatch = topMatches.map(m => ({
            candidateId: m.user.toString(),
            score: m.matchScore
        }));
        await batchSetCompatibilityScores(currentUser._id, scoresBatch);
        await setPotentialMatchesPool(currentUser._id, topMatches);
    } catch (redisErr) {
        console.error(`❌ Redis Sync Error for ${currentUser._id}:`, redisErr.message);
    }
  } catch (error) {
    console.error(`❌ Error finding matches for user ${currentUser._id}:`, error.message);
    await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() }).catch(() => {});
    throw error;
  }
}

// ✅ NEW: Section-Specific Refill Logic
export async function findMatchesForSection(currentUser, section, limit = 50) {
    try {
        console.log(`[MatchWorker] Finding ${limit} matches for section '${section}' (User: ${currentUser._id})`);
        
        const excludedIds = [
            currentUser._id,
            ...(currentUser.matches || []),
            ...(currentUser.likedUsers || []),
            ...(currentUser.dislikedUsers || [])
        ];

        let query = {
            _id: { $nin: excludedIds },
            "location.country": currentUser.location.country,
            "dna": { $exists: true, $ne: null },
            "dna.Logic": { $exists: true, $type: "number" }
        };

        if (currentUser.lookingFor) {
            query.gender = currentUser.lookingFor;
        }

        let sort = { createdAt: -1 }; // Default sort

        // Section Specific Filters
        if (section === "nearby") {
            if (currentUser.location.city) {
                // Use regex for flexible city matching
                query["location.city"] = { $regex: new RegExp(`^${currentUser.location.city}$`, "i") };
            }
        } else if (section === "fresh_faces") {
            // Already sorted by createdAt: -1
            // Ensure created in last 30 days?
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query.createdAt = { $gte: thirtyDaysAgo };
        } else if (section === "soulmates") {
             // For soulmates, we need high compatibility (> 90%). 
             // Since we can't query compatibility directly (it's computed), 
             // we rely on fetching randoms and sorting by score later.
             // Maybe relax country filter or focus on interests?
             // For now, standard query, we filter by score > 90 later.
        }

        // Fetch Candidates
        const candidates = await User.find(query)
            .select("dna location lookingFor name interests birthday gender subscription questionsbycategoriesResults createdAt avatar bio isVerified")
            .sort(sort)
            .limit(limit * 2) // Fetch double to allow for post-filtering
            .lean();

        // Calculate Scores
        let results = candidates.map(candidate => {
            const score = calculateCompatibility(currentUser, candidate);
            return {
                user: candidate._id,
                matchScore: score,
                updatedAt: new Date()
            };
        });

        // Sort based on section
        if (section === "soulmates") {
            results = results.filter(r => r.matchScore > 90); // Min score for soulmates (> 90%)
            results.sort((a, b) => b.matchScore - a.matchScore);
        } else if (section === "fresh_faces") {
            // Already sorted by query (createdAt) but ensure
             // results are already reasonably sorted by DB
        } else {
             // Default: Sort by Match Score
             results.sort((a, b) => b.matchScore - a.matchScore);
        }

        const finalMatches = results.slice(0, limit);

        if (finalMatches.length > 0) {
             // ✅ Merge into User's potentialMatches (Don't overwrite, just add/update)
             // We need to use bulkWrite or pull/push logic. 
             // Simple approach: Add to set.
             
             // 1. Add to User DB (Atomic: $addToSet doesn't work well with objects having dates, so we might need to pull first? 
             // Actually, potentialMatches schema usually has _id as subdoc? No, it's array of objects.
             // Let's use robust merge in Controller or here? 
             // Let's do it here. 
             
             // Efficient Merge: Retrieve current, merge in memory, save. (Concurrency risk but acceptable for single user flow)
             await User.findByIdAndUpdate(currentUser._id, {
                 $push: { 
                     potentialMatches: { 
                         $each: finalMatches,
                         $slice: -500 // Keep max 500
                     } 
                 }
             });

             // Sync Redis
             const scores = finalMatches.map(m => ({ candidateId: m.user.toString(), score: m.matchScore }));
             await batchSetCompatibilityScores(currentUser._id, scores);
             // Note: We don't overwrite the POOL here, we might append? 
             // `setPotentialMatchesPool` overwrites. 
             // For now, we assume Controller will handle the response display. 
             // Redis Pool sync might be complex if we want to "append". 
             // Let's skip over-writing Redis Pool for now, this function returns data for immediate use.
        }
        
        return finalMatches;

    } catch (err) {
        console.error(`[MatchWorker] Find Section Error:`, err);
        return [];
    }
}