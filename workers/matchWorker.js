import User from "../models/User.js";
import cron from "node-cron";
import { calculateCompatibility } from "../utils/matchUtils.js";

const BATCH_SIZE = 20; // کاهش از 50 به 20 برای مصرف کمتر حافظه
const CONCURRENT_USERS = 3; // پردازش حداکثر 3 کاربر همزمان (به جای همه)
const MAX_CANDIDATES = 150; // کاهش از 300 به 150 برای مصرف کمتر حافظه
// ✅ Scalability Fix: Removed MAX_TOTAL_USERS limit - process all users
// Priority: Users without lastMatchCalculation (new users) are processed first

let isRunning = false;
let processedCount = 0;

// تابع helper برای پردازش sequential با concurrency محدود
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
    
    // پاکسازی حافظه بعد از هر batch
    if (global.gc) {
      global.gc();
    }
    
    // استراحت کوتاه برای جلوگیری از overload
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results;
}

cron.schedule("0 */4 * * *", async () => {
  if (isRunning) {
    console.log("⏰ Internal Match Job: Already running, skipping...");
    return;
  }
  
  isRunning = true;
  processedCount = 0;
  const startTime = Date.now();
  
  try {
    console.log("⏰ Internal Match Job Started...");
    await processAllUsers();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Internal Match Job Completed: Processed ${processedCount} users in ${duration}s`);
  } catch (error) {
    console.error("❌ Internal Match Job Error:", error);
  } finally {
    isRunning = false;
    processedCount = 0;
  }
});

async function processAllUsers() {
  let hasMoreUsers = true;
  let skip = 0;
  let isProcessingNewUsers = true; // ✅ Scalability Fix: Process new users first

  // ✅ Scalability Fix: First, process users without lastMatchCalculation (new users)
  while (hasMoreUsers && isProcessingNewUsers) {
    const newUsersBatch = await User.find({
      lastMatchCalculation: { $exists: false }
    })
    .select("dna location lookingFor name interests birthday gender subscription questionsbycategoriesResults") 
    .lean()
    .limit(BATCH_SIZE)
    .skip(skip);

    if (newUsersBatch.length === 0) {
      isProcessingNewUsers = false;
      skip = 0; // Reset skip for old users
      break;
    }

    await processWithConcurrency(
      newUsersBatch, 
      CONCURRENT_USERS, 
      async (user) => {
        await findMatchesForUser(user);
        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`📊 Progress (New Users): ${processedCount} users processed...`);
        }
      }
    );

    skip += BATCH_SIZE;
    
    if (global.gc) {
      global.gc();
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // ✅ Scalability Fix: Then process users with outdated matches
  skip = 0;
  while (hasMoreUsers) {
    const usersBatch = await User.find({
      lastMatchCalculation: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
    .select("dna location lookingFor name interests birthday gender subscription questionsbycategoriesResults") 
    .lean()
    .limit(BATCH_SIZE)
    .skip(skip)
    .sort({ lastMatchCalculation: 1 }); // Oldest first

    if (usersBatch.length === 0) {
      hasMoreUsers = false;
      break;
    }

    await processWithConcurrency(
      usersBatch, 
      CONCURRENT_USERS, 
      async (user) => {
        await findMatchesForUser(user);
        processedCount++;
        if (processedCount % 50 === 0) {
          console.log(`📊 Progress (All Users): ${processedCount} users processed...`);
        }
      }
    );

    skip += BATCH_SIZE;
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (global.gc) {
      global.gc();
    }
  }
}

async function findMatchesForUser(currentUser) {
  try {
    if (!currentUser.location || !currentUser.location.country) {
        await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
        return;
    }

    // ✅ Fix 2: Better DNA validation
    if (!currentUser.dna || typeof currentUser.dna !== 'object') {
        console.warn(`⚠️ User ${currentUser._id} has no DNA. Skipping match calculation.`);
        await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
        return;
    }

    const myDNA = currentUser.dna || { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  
  let genderFilter = {};
  if (currentUser.lookingFor) {
      genderFilter = { gender: currentUser.lookingFor };
  }

  // ✅ Fix 2: DNA Null Check - Filter users without DNA first
  const candidates = await User.aggregate([
    {
      $match: {
        _id: { $ne: currentUser._id },
        "location.country": currentUser.location.country,
        "dna": { $exists: true, $ne: null }, // ✅ Only users with DNA
        "dna.Logic": { $exists: true, $type: "number" },
        "dna.Emotion": { $exists: true, $type: "number" },
        "dna.Energy": { $exists: true, $type: "number" },
        "dna.Creativity": { $exists: true, $type: "number" },
        "dna.Discipline": { $exists: true, $type: "number" },
        ...genderFilter
      }
    },
    {
      $addFields: {
        dnaDiff: {
          $add: [
            { $abs: { $subtract: [{ $ifNull: ["$dna.Logic", 50] }, myDNA.Logic] } },
            { $abs: { $subtract: [{ $ifNull: ["$dna.Emotion", 50] }, myDNA.Emotion] } },
            { $abs: { $subtract: [{ $ifNull: ["$dna.Energy", 50] }, myDNA.Energy] } },
            { $abs: { $subtract: [{ $ifNull: ["$dna.Creativity", 50] }, myDNA.Creativity] } },
            { $abs: { $subtract: [{ $ifNull: ["$dna.Discipline", 50] }, myDNA.Discipline] } }
          ]
        }
      }
    },
    { $sort: { dnaDiff: 1 } }, 
    { $limit: MAX_CANDIDATES }, 
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
            dna: 1,
            questionsbycategoriesResults: 1
        }
    }
  ]);

  const formattedMatches = candidates.map(candidate => {
    const exactScore = calculateCompatibility(currentUser, candidate);

    return {
        user: candidate._id,
        matchScore: exactScore, 
        updatedAt: new Date()
    };
  });

  formattedMatches.sort((a, b) => b.matchScore - a.matchScore);

  const topMatches = formattedMatches.slice(0, 100);

    await User.updateOne(
        { _id: currentUser._id },
        { 
            $set: { 
                potentialMatches: topMatches,
                lastMatchCalculation: new Date()
            }
        }
    );
  } catch (error) {
    // ✅ Fix 6: Proper error handling - update lastMatchCalculation even on error
    console.error(`❌ Error finding matches for user ${currentUser._id}:`, error.message);
    try {
      await User.updateOne(
        { _id: currentUser._id },
        { lastMatchCalculation: new Date() }
      );
    } catch (updateError) {
      console.error(`❌ Failed to update lastMatchCalculation for user ${currentUser._id}:`, updateError.message);
    }
    throw error; // Re-throw to be caught by processWithConcurrency
  }
}