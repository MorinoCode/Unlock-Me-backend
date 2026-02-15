import { Worker } from "bullmq";
import User from "../models/User.js";
import redisClient, { bullMQConnection } from "../config/redis.js";

const FEED_SIZE = 100;
const REFILL_THRESHOLD = 20;

// Core Logic: Generate Feed (Same as before but optimized)
export async function generateFeedForUser(currentUser) {
  try {
      console.log(`[SwipeFeedWorker] 🔄 Generating feed for ${currentUser._id}...`);
      
      const excludedIds = [
          currentUser._id,
          ...(currentUser.matches || []),
          ...(currentUser.likedUsers || []),
          ...(currentUser.dislikedUsers || []),
          ...(currentUser.blockedUsers || []),
          ...(currentUser.superLikedUsers || []) // Added superLikedUsers
      ];

      // Get users from DB that are NOT in excluded list
      // Optimization: Use aggregation with $sample for random selection
      const feed = await User.aggregate([
          { 
              $match: { 
                  _id: { $nin: excludedIds },
                  "location.country": currentUser.location?.country || "World",
                  // gender: currentUser.lookingFor // optional, if strict
              } 
          },
          { $sample: { size: 50 } }, // Fetch batch
          { $project: { _id: 1 } }
      ]);

      if (feed.length > 0) {
          const feedIds = feed.map(u => u._id.toString());
          const feedKey = `swipe:feed:${currentUser._id}`;
          
          // Push to Redis (Right side - Append)
          await redisClient.rPush(feedKey, feedIds);
          console.log(`[SwipeFeedWorker] ✅ Added ${feed.length} users to feed for ${currentUser._id}`);
          return true;
      } else {
          console.log(`[SwipeFeedWorker] ⚠️ No new users found for ${currentUser._id}`);
          return false;
      }
  } catch (error) {
      console.error(`[SwipeFeedWorker] ❌ Error generating feed:`, error);
      throw error; // Throw to let BullMQ know it failed
  }
}

// BullMQ Worker Processor
const swipeFeedProcessor = async (job) => {
    const { userId } = job.data;
    console.log(`[SwipeFeedWorker] ⚙️ Processing feed generation for ${userId}`);
    
    // Fetch user details needed for feed generation
    const user = await User.findById(userId).select(
        "location lookingFor matches likedUsers dislikedUsers superLikedUsers blockedUsers"
    ).lean();

    if (!user) {
        throw new Error(`User ${userId} not found`);
    }

    await generateFeedForUser(user);
    console.log(`[SwipeFeedWorker] ✅ Job ${job.id} completed`);
};

// Initialize Worker
const swipeFeedWorker = new Worker("swipe-feed", swipeFeedProcessor, {
    connection: bullMQConnection,
    concurrency: 5, // reasonable concurrency for feed generation
    limiter: {
        max: 10,
        duration: 1000,
    },
});

swipeFeedWorker.on("completed", (job) => {
    // console.log(`[SwipeFeedWorker] Job ${job.id} done`);
});

swipeFeedWorker.on("failed", (job, err) => {
    console.error(`[SwipeFeedWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [SwipeFeedWorker] Worker Started & Listening requires 'swipe-feed' queue...");

export default swipeFeedWorker;

