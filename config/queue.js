import { Queue } from "bullmq";
import redisClient from "./redis.js";

// Create a new queue instance
// We use the existing redisClient connection details but BullMQ needs its own connection logic
// generally, so we pass the connection settings.
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
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const exploreQueue = new Queue("explore-queue", {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const godateQueue = new Queue("godate-queue", {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const swipeActionQueue = new Queue("swipe-action-queue", {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const notificationQueue = new Queue("notification-queue", {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const mediaQueue = new Queue("media-queue", {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    defaultJobOptions,
});

const onboardingQueue = new Queue("onboarding-queue", {
  connection: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
  },
  defaultJobOptions,
});

console.log("✅ [Queue] Analysis, Explore, GoDate, Swipe, Notification, Media & Onboarding Queues Initialized");

export { analysisQueue, exploreQueue, godateQueue, swipeActionQueue, notificationQueue, mediaQueue, onboardingQueue };

