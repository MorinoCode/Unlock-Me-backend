import { Queue } from "bullmq";
import { bullMQConnection } from "../config/redis.js";

const swipeActionQueue = new Queue("swipe-action-queue", {
    connection: bullMQConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: 1000,
        removeOnFail: 2000,
    },
});

export const addToSwipeActionQueue = async (data) => {
    return swipeActionQueue.add("process-swipe-action", data);
};

export default swipeActionQueue;
