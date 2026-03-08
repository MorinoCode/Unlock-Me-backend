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

const analysisQueue = new Queue("analysis-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const exploreQueue = new Queue("explore-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const godateQueue = new Queue("godate-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const unlockActionQueue = new Queue("unlock-action-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const notificationQueue = new Queue("notification-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const mediaQueue = new Queue("media-queue", {
    connection: bullMQConnection,
    defaultJobOptions,
});

const onboardingQueue = new Queue("onboarding-queue", {
  connection: bullMQConnection,
  defaultJobOptions,
});

const messageQueue = new Queue("message-queue", {
  connection: bullMQConnection,
  defaultJobOptions,
});

console.log("✅ [Queue] Analysis, Explore, GoDate, unlock, Notification, Media, Onboarding & Message Queues Initialized");

export { analysisQueue, exploreQueue, godateQueue, unlockActionQueue, notificationQueue, mediaQueue, onboardingQueue, messageQueue };

export { 
  analysisQueue, exploreQueue, godateQueue, unlockActionQueue, 
  notificationQueue, mediaQueue, onboardingQueue, messageQueue,
  soulmateProducerQueue, soulmateConsumerQueue, arrayCleanupQueue, trialExpirationQueue
};
