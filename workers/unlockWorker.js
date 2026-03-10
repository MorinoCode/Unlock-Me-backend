import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import User from "../models/User.js";
import { 
    invalidateUserCache, 
    invalidateMatchesCache, 
    invalidateExploreCache 
} from "../utils/cacheHelper.js";
import { invalidateUserCaches } from "../utils/redisMatchHelper.js";
import { bullMQConnection } from "../config/redis.js";

const unlockWorkerHandler = async (job) => {
    const { userId, targetUserId, action, isMatch } = job.data;
    logger.info(`[unlockWorker] ⚙️ Processing ${action} from ${userId} to ${targetUserId}`);

    try {
        const now = new Date();

        // 1. Prepare Updates for my User
        let updateQuery = {};
        if (action === "left") {
            // ✅ Phase 4: Dislikes are Redis-only. We don't write them to MongoDB.
            logger.info(`[unlockWorker] 🏎️ Skipping MongoDB write for Dislike from ${userId}`);
            // Still update usage/lastunlockDate below though
        } else {
            const updateField = action === "right" ? "likedUsers" : "superLikedUsers";
            updateQuery = { $addToSet: { [updateField]: targetUserId } };
            
            if (isMatch) {
                updateQuery.$addToSet.matches = targetUserId;
            }
        }
        
        // Update my usage in DB (Eventually consistent)
        updateQuery.$set = { "usage.lastunlockDate": now };
        // We still increment in DB for long-term tracking, even if API uses Redis for limits
        updateQuery.$inc = { "usage.unlocksCount": 1 };
        if (action === "up") {
            updateQuery.$inc["usage.superLikesCount"] = 1;
        }

        // 2. Perform Updates
        const myUpdate = User.findByIdAndUpdate(userId, updateQuery);
        const targetUpdate = action === "up" 
            ? User.findByIdAndUpdate(targetUserId, { $addToSet: { superLikedBy: userId } })
            : null;
        
        const matchUpdate = isMatch 
            ? User.findByIdAndUpdate(targetUserId, { $addToSet: { matches: userId } })
            : null;

        await Promise.all([myUpdate, targetUpdate, matchUpdate].filter(Boolean));

        // 3. Cache Invalidation
        const matchTypes = ["matches_dashboard", "mutual", "incoming", "sent", "superlikes"];
        const invalidateCurrent = matchTypes.map((t) => invalidateMatchesCache(userId, t));
        const invalidateTarget = matchTypes.map((t) => invalidateMatchesCache(targetUserId, t));

        await Promise.all([
            invalidateUserCache(userId),
            invalidateUserCache(targetUserId),
            invalidateUserCaches(userId),
            invalidateMatchesCache(userId, "unlock"),
            invalidateExploreCache(userId),
            ...invalidateCurrent,
            ...invalidateTarget,
        ]).catch((err) => logger.error("[unlockWorker] Invalidation error:", err));

        logger.info(`✅ [unlockWorker] Successfully persisted ${action} for ${userId}`);
        return { success: true };

    } catch (error) {
        logger.error(`❌ [unlockWorker] PERSISTENCE FAILED for ${userId}: ${error.message}`);
        throw error;
    }
};

const unlockWorker = new Worker("unlock-action-queue", unlockWorkerHandler, {
    connection: bullMQConnection,
    concurrency: 10 // Higher concurrency as these are simple DB writes
});

unlockWorker.on("completed", () => {
    // logger.info(`[unlockWorker] Job ${job.id} completed!`);
});

unlockWorker.on("failed", (job, err) => {
    logger.error(`[unlockWorker] Job ${job.id} failed: ${err.message}`);
});

logger.info("✅ [unlockWorker] Worker Started & Listening...");

export default unlockWorker;
