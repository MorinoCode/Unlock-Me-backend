import { Queue } from "bullmq";
import { bullMQConnection } from "../config/redis.js";

const unlockActionQueue = new Queue("unlock-action-queue", {
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

export const addTounlockActionQueue = async (data) => {
    return unlockActionQueue.add("process-unlock-action", data);
};

export default unlockActionQueue;
