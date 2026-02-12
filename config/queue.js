import { Queue } from "bullmq";
import { bullMQConnection } from "./redis.js";

// Create a new queue instance
const defaultJobOptions = {
    removeOnComplete: true, // Automatically remove successful jobs
    removeOnFail: 1000,    // Keep last 1000 failed jobs for debugging
    attempts: 3,           // Retry 3 times
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

const swipeActionQueue = new Queue("swipe-action-queue", {
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

console.log("✅ [Queue] Analysis, Explore, GoDate, Swipe, Notification, Media & Onboarding Queues Initialized");

export { analysisQueue, exploreQueue, godateQueue, swipeActionQueue, notificationQueue, mediaQueue, onboardingQueue };

