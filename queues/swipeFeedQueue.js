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
