import logger from "../utils/logger.js";

import { Worker } from "bullmq";
import { addToExploreIndex, removeFromExploreIndex } from "../utils/redisMatchHelper.js";
import { bullMQConnection } from "../config/redis.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

// Connect to Mongo
const connectMongo = async () => {
    if (mongoose.connection.readyState === 0) {
        try {
            await mongoose.connect(MONGO_URI);
            logger.info("✅ Explore Worker Connected to MongoDB");
        } catch (err) {
            logger.error("❌ Explore Worker MongoDB Error:", err);
            process.exit(1);
        }
    }
};

const workerHandler = async (job) => {
    const { type, userId, oldData } = job.data;
    // logger.info(`[ExploreWorker] Processing ${type} for ${userId}`);

    try {
        await connectMongo();

        if (type === "SYNC_USER") {
            const user = await User.findById(userId).lean();
            if (user) {
                // 1. Remove old indices if old data is provided
                if (oldData) {
                    await removeFromExploreIndex({ _id: userId, ...oldData });
                }
                // 2. Add current indices
                await addToExploreIndex(user);
                 // logger.info(`✅ Synced User ${userId}`);
            }
        } else if (type === "REMOVE_USER") {
             if (oldData) {
                await removeFromExploreIndex({ _id: userId, ...oldData });
                logger.debug(`🗑️ Removed User ${userId} from Explore`);
            }
        }
    } catch (err) {
        logger.error(`❌ [ExploreWorker] Job Failed: ${err.message}`);
        throw err;
    }
};

// Initialize BullMQ Worker
const exploreWorker = new Worker("explore-queue", workerHandler, {
    connection: bullMQConnection,
    concurrency: 5 // Parallel processing
});

exploreWorker.on("completed", () => {
    // logger.info(`[ExploreWorker] Job ${job.id} completed`);
});

exploreWorker.on("failed", (job, err) => {
    logger.error(`[ExploreWorker] Job ${job.id} failed: ${err.message}`);
});

logger.info("🚀 Explore Worker Started (BullMQ: explore-queue)...");

// ✅ Crash Protection
process.on("unhandledRejection", (reason, promise) => {
    logger.error("🚨 [ExploreWorker] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    logger.error("🚨 [ExploreWorker] Uncaught Exception:", err);
});

export default exploreWorker;
