import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";
import { cleanupUserArrays } from "../utils/arrayLimiter.js";

const arrayCleanupProcessor = async (job) => {
  const startTime = Date.now();

  const users = await User.find({
    $or: [
      { $expr: { $gt: [{ $size: "$likedUsers" }, 5000] } },
      { $expr: { $gt: [{ $size: "$dislikedUsers" }, 20000] } },
      { $expr: { $gt: [{ $size: "$potentialMatches" }, 500] } },
      { $expr: { $gt: [{ $size: "$matches" }, 5000] } }
    ]
  }).select("_id").lean();
  
  let cleaned = 0;
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      await cleanupUserArrays(user._id);
      cleaned++;
      await job.updateProgress(Math.floor(((i + 1) / users.length) * 100));
    } catch (error) {
      logger.error(error);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  return { success: true, usersCleaned: cleaned, duration };
};

const arrayCleanupWorker = new Worker("array-cleanup-queue", arrayCleanupProcessor, {
    connection: bullMQConnection,
    concurrency: 1,
    lockDuration: 300000, 
});

export default arrayCleanupWorker;
