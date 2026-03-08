import { Worker } from "bullmq";
import User from "../models/User.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
import { calculateCompatibility } from "../utils/matchUtils.js";

// const FEED_SIZE = 100;
// const REFILL_THRESHOLD = 20;

// Core Logic: Generate Feed (Same as before but optimized)
export async function generateFeedForUser(currentUser) {
  try {
      console.log(`[unlockFeedWorker] 🔄 Generating feed for ${currentUser._id}...`);
      
      const excludedIds = [
          currentUser._id,
          ...(currentUser.matches || []),
          ...(currentUser.likedUsers || []),
          ...(currentUser.dislikedUsers || []),
          ...(currentUser.blockedUsers || []),
          ...(currentUser.blockedBy || []),
          ...(currentUser.superLikedUsers || []) // Added superLikedUsers
      ];

      // Get users from DB that are NOT in excluded list
      // Optimization: Use aggregation with $sample for random selection
      const feed = await User.aggregate([
          { 
              $match: { 
                  _id: { $nin: excludedIds },
                  "location.country": currentUser.location?.country || "World",
                  "dna": { $exists: true, $ne: null },
                  "dna.Logic": { $exists: true, $type: "number" }
                  // gender: currentUser.lookingFor // optional, if strict
              } 
          },
          { $sample: { size: 50 } }, // Fetch batch
          { $project: { _id: 1, dna: 1, interests: 1, birthday: 1, gender: 1, location: 1 } }
      ]);

      if (feed.length > 0) {
          const feedKey = `unlock:feed:zset:${currentUser._id}`;
          
          // O(1) bulk push to Redis ZSET sorted by Match Score
          const pipeline = redisClient.multi();
          feed.forEach(candidate => {
              const score = calculateCompatibility(currentUser, candidate);
              pipeline.zAdd(feedKey, { score, value: candidate._id.toString() });
          });
          await pipeline.exec();
          
          console.log(`[unlockFeedWorker] ✅ Added ${feed.length} users to ZSET feed for ${currentUser._id}`);
          return true;
      } else {
          console.log(`[unlockFeedWorker] ⚠️ No new users found for ${currentUser._id}`);
          return false;
      }
  } catch (error) {
      console.error(`[unlockFeedWorker] ❌ Error generating feed:`, error);
      throw error; // Throw to let BullMQ know it failed
  }
}

// BullMQ Worker Processor
const unlockFeedProcessor = async (job) => {
    const { userId } = job.data;
    console.log(`[unlockFeedWorker] ⚙️ Processing feed generation for ${userId}`);
    
    // Fetch user details needed for feed generation and scoring
    const user = await User.findById(userId).select(
        "location lookingFor matches likedUsers dislikedUsers superLikedUsers blockedUsers blockedBy dna interests birthday gender"
    ).lean();

    if (!user) {
        throw new Error(`User ${userId} not found`);
    }

    await generateFeedForUser(user);
    console.log(`[unlockFeedWorker] ✅ Job ${job.id} completed`);
};

const unlockFeedWorker = new Worker("unlock-feed", unlockFeedProcessor, {
    connection: bullMQConnection,
    concurrency: 5,
    limiter: {
        max: 10,
        duration: 1000,
    },
});

unlockFeedWorker.on("completed", () => {
});

unlockFeedWorker.on("failed", (job, err) => {
    console.error(`[unlockFeedWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [unlockFeedWorker] Worker Started & Listening requires 'unlock-feed' queue...");

export default unlockFeedWorker;

