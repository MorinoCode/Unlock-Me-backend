import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import { cleanupUserArrays } from "../utils/arrayLimiter.js";

const arrayCleanupConsumerProcessor = async (job) => {
  const { userId } = job.data;
  await cleanupUserArrays(userId);
  return { success: true };
};

const arrayCleanupConsumer = new Worker("array-cleanup-queue", arrayCleanupConsumerProcessor, {
    connection: bullMQConnection,
    concurrency: 5,
});

export default arrayCleanupConsumer;
