import { Worker } from "bullmq";
import GoDate from "../models/GoDate.js";
import GoDateApply from "../models/GoDateApply.js";
import cloudinary from "../config/cloudinary.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const EXPIRED_THRESHOLD_MS = 5 * 60 * 1000;

const workerHandler = async (job) => {
    const { type, data } = job.data;
    console.log(`[GoDateWorker] ⚙️ Processing job: ${type}`);

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
        console.error(`❌ [GoDateWorker] Failed: ${error.message}`);
        throw error;
    }
};

// Initialize Worker
const goDateWorker = new Worker("godate-queue", workerHandler, {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    concurrency: 2
});

goDateWorker.on("completed", (job) => {
    console.log(`[GoDateWorker] Job ${job.id} completed!`);
});

goDateWorker.on("failed", (job, err) => {
    console.error(`[GoDateWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [GoDateWorker] Worker Started & Listening...");

// ✅ Crash Protection
process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 [GoDateWorker] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("🚨 [GoDateWorker] Uncaught Exception:", err);
});

export default goDateWorker;
