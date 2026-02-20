import { Queue } from "bullmq";
import { bullMQConnection } from "../config/redis.js";

const unlockFeedQueue = new Queue("unlock-feed", {
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

export const addTounlockFeedQueue = async (userId, priority = false) => {
  try {
    await unlockFeedQueue.add(
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

export default unlockFeedQueue;
