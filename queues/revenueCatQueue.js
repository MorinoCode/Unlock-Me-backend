import { Queue } from "bullmq";
import { bullMQConnection } from "../config/redis.js";

const revenueCatQueue = new Queue("revenuecat-webhook-queue", {
    connection: bullMQConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: 2000,
        removeOnFail: 5000,
    },
});

export const addToRevenueCatQueue = async (data) => {
    return revenueCatQueue.add("process-revenuecat-webhook", data);
};

export default revenueCatQueue;
