import { exploreQueue } from "../config/queue.js";

/**
 * Dispatch sync job to Explore Worker (BullMQ)
 */
export const dispatchExploreSync = async (userId, oldData = null) => {
  try {
    // BullMQ: Add job to "explore-queue"
    // We use 'sync' as the job name
    await exploreQueue.add("sync", { 
        type: "SYNC_USER", 
        userId: userId.toString(), 
        oldData 
    }, {
        attempts: 3, // Retry 3 times on failure
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 100 // Keep last 100 failed jobs for inspection
    });
  } catch (err) {
    console.error("Dispatch Explore Sync Error:", err);
  }
};
