import User from "../models/User.js";
import cron from "node-cron";
import redisClient from "../config/redis.js";

const FEED_SIZE = 100; // Pre-fetch 100 users (was 50)
const REFILL_THRESHOLD = 20; // Trigger refill when feed < 20 (was 10)
const BATCH_SIZE = 20; // Process 20 users at a time
const CONCURRENT_USERS = 3; // Process 3 users concurrently

let isRunning = false;
let processedCount = 0;

// Helper for sequential processing with concurrency
async function processWithConcurrency(items, concurrency, processor) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(item => processor(item).catch(err => {
        console.error(`Error processing user ${item._id}:`, err.message);
        return null;
      }))
    );
    results.push(...batchResults.filter(r => r !== null));
    
    if (global.gc) {
      global.gc();
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results;
}

// Cron Job: Run every 6 hours to refresh feeds
cron.schedule("0 */6 * * *", async () => {
  if (isRunning) {
    console.log("⏰ Swipe Feed Job: Already running, skipping...");
    return;
  }
  
  isRunning = true;
  processedCount = 0;
  const startTime = Date.now();
  
  try {
    console.log("⏰ Swipe Feed Job Started...");
    await processAllUsers();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Swipe Feed Job Completed: Processed ${processedCount} users in ${duration}s`);
  } catch (error) {
    console.error("❌ Swipe Feed Job Error:", error);
  } finally {
    isRunning = false;
    processedCount = 0;
  }
});

async function processAllUsers() {
  // Process active users (swiped in last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  let skip = 0;
  let hasMoreUsers = true;

  while (hasMoreUsers) {
    const usersBatch = await User.find({
      $or: [
        { "usage.lastSwipeDate": { $gte: sevenDaysAgo } },
        { createdAt: { $gte: sevenDaysAgo } } // Include new users
      ]
    })
    .select("location lookingFor likedUsers dislikedUsers superLikedUsers matches blockedUsers")
    .lean()
    .limit(BATCH_SIZE)
    .skip(skip);
    
    if (usersBatch.length === 0) {
      hasMoreUsers = false;
      break;
    }

    await processWithConcurrency(
      usersBatch, 
      CONCURRENT_USERS, 
      async (user) => {
        await generateFeedForUser(user);
        processedCount++;
        if (processedCount % 50 === 0) {
          console.log(`📊 Progress: ${processedCount} users processed...`);
        }
      }
    );

    skip += BATCH_SIZE;
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (global.gc) global.gc();
  }
}

// Core Function: Generate feed for a single user (Global Scale Architecture)
export async function generateFeedForUser(currentUser) {
  try {
    const userId = currentUser._id;
    const CANDIDATE_POOL_SIZE = 500; // Fetch pool size
    
    console.log(`\n========================================`);
    console.log(`[SwipeFeedWorker] 🚀 STARTING for user: ${userId}`);

    // 1. ✅ Gender Logic (Standard: Male, Female, Other)
    let genderQuery = {};
    if (currentUser.lookingFor && ["Male", "Female", "Other"].includes(currentUser.lookingFor)) {
      genderQuery.gender = currentUser.lookingFor;
    }

    // 2. ✅ Get Exclusion List (Redis Strategy)
    const historyKey = `swipe:history:${userId}`;
    const swipedIds = await redisClient.sMembers(historyKey);
    const swipedSet = new Set(swipedIds);

    // Local exclusions
    const dbExclusions = new Set([
        userId.toString(),
        ...(currentUser.matches || []).map(id => id.toString()),
        ...(currentUser.blockedUsers || []).map(id => id.toString())
    ]);

    // Helper to calculate compatibility score (0-100)
    const calculateMatchScore = (userA, userB) => {
        if (!userA.dna || !userB.dna) return 50; // Default if no DNA
        
        const traits = ['Logic', 'Emotion', 'Energy', 'Creativity', 'Discipline'];
        let diffSum = 0;
        
        traits.forEach(trait => {
            const valA = userA.dna[trait] || 50;
            const valB = userB.dna[trait] || 50;
            diffSum += Math.abs(valA - valB);
        });

        // Max possible difference is 500 (100*5). We want similarity.
        // Similarity % = 100 - (TotalDiff / 5)
        // Example: Total Diff 50 -> 100 - 10 = 90% Match
        return Math.max(0, 100 - (diffSum / 5));
    };

    // Helper to fetch candidates
    const fetchCandidates = async (country, limit) => {
        const query = {
            "location.country": country,
            ...genderQuery
        };

        console.log(`[SwipeFeedWorker] Querying ${country}...`);
        return await User.aggregate([
            { $match: query },
            { $sample: { size: limit } },
            // Optimization: Only fetch fields needed for scoring!
            { $project: { _id: 1, dna: 1, lastActive: "$usage.lastSwipeDate" } }
        ]);
    };

    // 3. ✅ Cascading Fetch (Local -> USA)
    let userCountry = currentUser.location?.country || "USA";
    let validCandidates = [];
    
    // A. Try Local Country
    let rawCandidates = await fetchCandidates(userCountry, CANDIDATE_POOL_SIZE);
    
    // Process Local Candidates
    for (const c of rawCandidates) {
        const id = c._id.toString();
        if (!swipedSet.has(id) && !dbExclusions.has(id)) {
            // Calculate Score On-The-Fly (In Memory)
            c.score = calculateMatchScore(currentUser, c);
            validCandidates.push(c);
        }
    }

    // B. Fallback to USA
    if (validCandidates.length < FEED_SIZE && userCountry !== "USA") {
        console.log(`[SwipeFeedWorker] ⚠️ Fallback to USA.`);
        const needed = CANDIDATE_POOL_SIZE - validCandidates.length;
        const usaCandidates = await fetchCandidates("USA", needed);
        
        for (const c of usaCandidates) {
            const id = c._id.toString();
            // Check duplicates against local bucket
            if (!swipedSet.has(id) && !dbExclusions.has(id) && !validCandidates.some(vc => vc._id.toString() === id)) {
                c.score = calculateMatchScore(currentUser, c);
                validCandidates.push(c);
            }
        }
    }

    // 4. ✅ Sort by Compatibility (Ranking) 🧠
    // The "World Class" feature: Show best matches first!
    validCandidates.sort((a, b) => b.score - a.score);

    // Slice to FEED_SIZE
    validCandidates = validCandidates.slice(0, FEED_SIZE);

    if (validCandidates.length === 0) {
       console.warn(`[SwipeFeedWorker] ❌ No valid candidates found.`);
       return false;
    }

    // 5. ✅ Store & Expire
    const feedKey = `swipe:feed:${userId}`;
    const feedIds = validCandidates.map(c => c._id.toString());
    
    await redisClient.del(feedKey);
    await redisClient.rPush(feedKey, feedIds);
    await redisClient.expire(feedKey, 7 * 24 * 60 * 60);

    console.log(`✅ [SwipeFeedWorker] Feed updated: ${feedIds.length} users (Sorted by DNA Score).`);
    return true;

  } catch (error) {
    console.error(`❌ Error generating feed for user ${currentUser._id}:`, error.message);
    throw error;
  }
}

// Exported function for manual/triggered refills
export async function refillFeed(userId) {
  try {
    const user = await User.findById(userId).select(
      "location lookingFor likedUsers dislikedUsers superLikedUsers matches blockedUsers"
    ).lean();

    if (!user) {
      console.warn(`⚠️ User ${userId} not found for refill`);
      return;
    }

    await generateFeedForUser(user);
  } catch (error) {
    console.error(`❌ Refill error for user ${userId}:`, error.message);
  }
}

// Check if feed needs refill
export async function checkAndRefillFeed(userId) {
  try {
    const feedKey = `swipe:feed:${userId}`;
    const feedSize = await redisClient.lLen(feedKey);

    if (feedSize < REFILL_THRESHOLD) {
      console.log(`🔄 Feed low for user ${userId} (${feedSize} items). Triggering refill...`);
      await refillFeed(userId);
    }
  } catch (error) {
    console.error(`❌ Check refill error for user ${userId}:`, error.message);
  }
}

console.log("✅ Swipe Feed Worker Initialized");
