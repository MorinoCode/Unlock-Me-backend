import { Worker } from "bullmq";
import redisClient, { bullMQConnection } from "../config/redis.js";
import User from "../models/User.js";
import { generateAnalysisData } from "./exploreMatchWorker.js";
import { generateFeedForUser } from "./unlockFeedWorker.js";

// Duplicate Redis connection for connection sharing if needed, 
// though BullMQ manages its own. We need redisClient for Pub/Sub or DB updates.

const workerHandler = async (job) => {
    const { userId } = job.data;
    console.log(`[AnalysisWorker] ⚙️ Processing job for user: ${userId}`);
    const startTime = Date.now();

    try {
        // 1. Fetch User (Full object for sub-workers)
        const user = await User.findById(userId).lean();

        if (!user) {
            console.error(`[AnalysisWorker] ❌ Critical Error: User ${userId} not found in DB`);
            throw new Error("User not found");
        }
        
        console.log(`[AnalysisWorker] 👤 User Info: ${user.name} | Country: ${user.location?.country} | City: ${user.location?.city}`);
        console.log(`[AnalysisWorker] 🔍 DEBUG USER OBJ:`, JSON.stringify(user, null, 2));

        if (!user.location?.country) {
            console.error(`[AnalysisWorker] ❌ Critical Error: User ${userId} is missing 'location.country'`);
            throw new Error("User location missing");
        }

        // 2. Run Heavy Logic
        console.log(`[AnalysisWorker] ⚙️ Running parallel workers (Explore + unlock)...`);
        
        // Run them continuously but wait for both
        const explorePromise = generateAnalysisData(userId).then(async (res) => {
             if (res) {
                 await redisClient.publish("job-events", JSON.stringify({ 
                    type: 'EXPLORE_COMPLETE',
                    userId, 
                    success: true 
                }));
             }
             return res;
        });

        const feedPromise = generateFeedForUser(user).then(async (res) => {
            if (res) {
                await redisClient.publish("job-events", JSON.stringify({ 
                    type: 'unlock_FEED_COMPLETE',
                    userId, 
                    success: true 
                }));
            }
            return res;
        });

        const [analysisResult, feedResult] = await Promise.all([explorePromise, feedPromise]);

        console.log(`[AnalysisWorker] 📊 Results Summary for ${userId}:`);
        console.log(`   - Explore Data: ${analysisResult ? "✅ SUCCESS (Object)" : "❌ FAILED (NULL)"}`);
        console.log(`   - unlock Feed: ${feedResult ? "✅ SUCCESS" : "⚠️ SKIPPED/DISABLED (False)"}`);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ [AnalysisWorker] Total execution time: ${duration}s`);

        if (analysisResult !== null) {
            // ✅ Success (We prioritize Explore/Analysis Data. Feed is optional but tracked)
            await redisClient.set(`user:ready:${userId}`, "true", { EX: 3600 });
            
            // 4. Update MongoDB
            await User.findByIdAndUpdate(userId, { 
                lastMatchCalculation: new Date()
            }, { lean: true }); 

            // 5. Publish Final Event
            const message = JSON.stringify({ 
                type: 'ANALYSIS_COMPLETE',
                userId, 
                success: true,
                duration 
            });
            await redisClient.publish("job-events", message);
            
            return { success: true, duration };
        } else {
            throw new Error("AnalysisWorker (Explore) failed to return data");
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
    connection: bullMQConnection,
    concurrency: 5 // Process 5 jobs at once (Scalable!)
});

analysisWorker.on("completed", (job) => {
    console.log(`[AnalysisWorker] Job ${job.id} completed!`);
});

analysisWorker.on("failed", (job, err) => {
    console.error(`[AnalysisWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("\n\n************************************************************");
console.log("*   ✅ [AnalysisWorker] NEW VERSION LOADED! (Step 43)    *");
console.log("************************************************************\n\n");
console.log("✅ [AnalysisWorker] Worker Started & Listening...");

// ✅ Crash Protection: Handle unexpected errors without exiting
process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 [AnalysisWorker] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("🚨 [AnalysisWorker] Uncaught Exception:", err);
});

export default analysisWorker;
