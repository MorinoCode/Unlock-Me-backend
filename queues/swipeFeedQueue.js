import { Queue } from "bullmq";
import { bullMQConnection } from "../config/redis.js";

const swipeFeedQueue = new Queue("swipe-feed", {
  connection: bullMQConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

export const addToSwipeFeedQueue = async (userId, priority = false) => {
  try {
    await swipeFeedQueue.add(
      "generate-feed",
      { userId },
      {
        priority: priority ? 1 : 2, // 1 is higher priority? BullMQ uses 1 as highest? No, usually lower number = higher priority or vice versa. 
        // BullMQ: "Jobs with higher priority will be processed before jobs with lower priority." 
        // Wait, standard is 1 (high) to MAX_INT (low)? 
        // Actually BullMQ docs say: "Ranges from 1 (highest priority) to 2097152 (lowest priority)."
        priority: priority ? 1 : 10,
        jobId: `feed-${userId}-${Date.now()}` // Prevent duplicates if needed, or allow
      }
    );
    console.log(`[Queue] Added refill job for ${userId}`);
  } catch (err) {
    console.error(`[Queue] Failed to add job for ${userId}`, err);
  }
};

export default swipeFeedQueue;
