import { Queue } from "bullmq";
import { bullMQConnection } from "./redis.js";

const defaultJobOptions = {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
        type: "exponential",
        delay: 1000,
    },
};

const analysisQueue = new Queue("analysis-queue", { connection: bullMQConnection, defaultJobOptions });
const exploreQueue = new Queue("explore-queue", { connection: bullMQConnection, defaultJobOptions });
const godateQueue = new Queue("godate-queue", { connection: bullMQConnection, defaultJobOptions });
const unlockActionQueue = new Queue("unlock-action-queue", { connection: bullMQConnection, defaultJobOptions });
const notificationQueue = new Queue("notification-queue", { connection: bullMQConnection, defaultJobOptions });
const mediaQueue = new Queue("media-queue", { connection: bullMQConnection, defaultJobOptions });
const onboardingQueue = new Queue("onboarding-queue", { connection: bullMQConnection, defaultJobOptions });
const messageQueue = new Queue("message-queue", { connection: bullMQConnection, defaultJobOptions });
const soulmateProducerQueue = new Queue("soulmate-producer-queue", { connection: bullMQConnection, defaultJobOptions });
const soulmateConsumerQueue = new Queue("soulmate-consumer-queue", { connection: bullMQConnection, defaultJobOptions });
const arrayCleanupQueue = new Queue("array-cleanup-queue", { connection: bullMQConnection, defaultJobOptions });
const trialExpirationQueue = new Queue("trial-expiration-queue", { connection: bullMQConnection, defaultJobOptions });

const initRepeatableJobs = async () => {
  try {
    await soulmateProducerQueue.add("soulmate-producer-job", {}, {
      repeat: { pattern: "*/5 * * * *", tz: "UTC" },
      jobId: "soulmate-producer-repeatable"
    });

    await arrayCleanupQueue.add("array-cleanup-job", {}, {
      repeat: { pattern: "*/5 * * * *", tz: "UTC" },
      jobId: "array-cleanup-repeatable"
    });

    await trialExpirationQueue.add("trial-expiration-job", {}, {
      repeat: { pattern: "*/5 * * * *", tz: "UTC" },
      jobId: "trial-expiration-repeatable"
    });

    await godateQueue.add("godate-cleanup-job", { type: "CLEANUP_EXPIRED" }, {
      repeat: { pattern: "*/30 * * * *", tz: "UTC" },
      jobId: "godate-cleanup-repeatable"
    });
  } catch (error) {
    console.error(error);
  }
};

initRepeatableJobs();

export { 
  analysisQueue, exploreQueue, godateQueue, unlockActionQueue, 
  notificationQueue, mediaQueue, onboardingQueue, messageQueue,
  soulmateProducerQueue, soulmateConsumerQueue, arrayCleanupQueue, trialExpirationQueue
};
