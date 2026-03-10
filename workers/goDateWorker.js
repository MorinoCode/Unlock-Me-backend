import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import GoDate from "../models/GoDate.js";
import { bullMQConnection } from "../config/redis.js";
import cloudinary from "../config/cloudinary.js";
import dotenv from "dotenv";

dotenv.config();

const EXPIRED_THRESHOLD_MS = 5 * 60 * 1000;

const workerHandler = async (job) => {
    const { type, data } = job.data;
    logger.info(`[GoDateWorker] ⚙️ Processing job: ${type}`);

    try {
        if (type === "CLEANUP_EXPIRED") {
            const now = Date.now();
            const expiredDates = await GoDate.find({
                status: "open",
                dateTime: { $lt: new Date(now - EXPIRED_THRESHOLD_MS) },
            });

            for (const date of expiredDates) {
                date.status = "expired";
                await date.save();
                if (date.imageId) {
                    await cloudinary.uploader.destroy(date.imageId).catch(() => {});
                }
            }
        } 
        
        else if (type === "NOTIFICATION") {
            // ✅ High Scale Fix: Move all notifications to background worker
            const { receiverId, notificationData } = data;
            const { emitNotification } = await import("../utils/notificationHelper.js");
            
            // This is now safe to run in background without blocking the main event loop
            await emitNotification(null, receiverId, notificationData);
        }
        
        return { success: true };
    } catch (error) {
        logger.error(`❌ [GoDateWorker] Failed: ${error.message}`);
        throw error;
    }
};

// Initialize Worker
const goDateWorker = new Worker("godate-queue", workerHandler, {
    connection: bullMQConnection,
    concurrency: 2
});

goDateWorker.on("completed", (job) => {
    logger.info(`[GoDateWorker] Job ${job.id} completed!`);
});

goDateWorker.on("failed", (job, err) => {
    logger.error(`[GoDateWorker] Job ${job.id} failed: ${err.message}`);
});

logger.info("✅ [GoDateWorker] Worker Started & Listening...");

// ✅ Crash Protection
process.on("unhandledRejection", (reason, promise) => {
    logger.error("🚨 [GoDateWorker] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    logger.error("🚨 [GoDateWorker] Uncaught Exception:", err);
});

export default goDateWorker;
