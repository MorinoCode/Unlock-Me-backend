import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import { cleanupUserArrays } from "../utils/arrayLimiter.js";

const arrayCleanupConsumerProcessor = async (job) => {
  const { userId } = job.data;
  
  try {
    await cleanupUserArrays(userId);
    return { success: true };
  } catch (error) {
    throw error;
  }
};

const arrayCleanupConsumer = new Worker("array-cleanup-queue", arrayCleanupConsumerProcessor, {
    connection: bullMQConnection,
    concurrency: 5,
});

export default arrayCleanupConsumer;
