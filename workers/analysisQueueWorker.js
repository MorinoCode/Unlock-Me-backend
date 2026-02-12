import { Worker } from "bullmq";
import redisClient from "../config/redis.js";
import User from "../models/User.js";
import { generateAnalysisData } from "./exploreMatchWorker.js";
import { generateFeedForUser } from "./swipeFeedWorker.js";

// Duplicate Redis connection for connection sharing if needed, 
// though BullMQ manages its own. We need redisClient for Pub/Sub or DB updates.

const workerHandler = async (job) => {
    const { userId } = job.data;
    console.log(`[AnalysisWorker] ⚙️ Processing job for user: ${userId}`);
    const startTime = Date.now();

    try {
        // 1. Fetch User
        const user = await User.findById(userId).select(
            "location lookingFor likedUsers dislikedUsers superLikedUsers matches blockedUsers"
        ).lean();

        if (!user) throw new Error("User not found");
        if (!user.location?.country) throw new Error("User location missing");

        // 2. Run Heavy Logic
        console.log(`[AnalysisWorker] Running calculations...`);
        const [analysisResult, feedResult] = await Promise.all([
            generateAnalysisData(userId),
            generateFeedForUser(user)
        ]);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [AnalysisWorker] Job completed in ${duration}s`);

        if (analysisResult && feedResult) {
            // 3. Mark User Ready in Redis
            await redisClient.set(`user:ready:${userId}`, "true", { EX: 3600 });
            
            // 4. Update MongoDB
            await User.findByIdAndUpdate(userId, { 
                lastMatchCalculation: new Date()
            }, { lean: true }); // optimize update

            // 5. Publish Event for Socket.IO (via server.js)
            // We publish to a dedicated channel: 'job-events'
            const message = JSON.stringify({ 
                type: 'ANALYSIS_COMPLETE',
                userId, 
                success: true,
                duration 
            });
            await redisClient.publish("job-events", message);
            
            return { success: true, duration };
        } else {
            throw new Error("One or more workers failed to return data");
        }

    } catch (error) {
        console.error(`❌ [AnalysisWorker] Failed: ${error.message}`);
        // Publish failure event
        const message = JSON.stringify({ 
            type: 'ANALYSIS_FAILED',
            userId, 
            error: error.message 
        });
        await redisClient.publish("job-events", message);
        throw error; // Rethrow to mark job as failed in BullMQ
    }
};

// Initialize Worker
const analysisWorker = new Worker("analysis-queue", workerHandler, {
    connection: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
    },
    concurrency: 5 // Process 5 jobs at once (Scalable!)
});

analysisWorker.on("completed", (job) => {
    console.log(`[AnalysisWorker] Job ${job.id} completed!`);
});

analysisWorker.on("failed", (job, err) => {
    console.error(`[AnalysisWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [AnalysisWorker] Worker Started & Listening...");

// ✅ Crash Protection: Handle unexpected errors without exiting
process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 [AnalysisWorker] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("🚨 [AnalysisWorker] Uncaught Exception:", err);
});

export default analysisWorker;
