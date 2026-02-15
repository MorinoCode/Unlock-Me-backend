import { Worker } from "bullmq";
import User from "../models/User.js";
import { 
    invalidateUserCache, 
    invalidateMatchesCache, 
    invalidateExploreCache 
} from "../utils/cacheHelper.js";
import { invalidateUserCaches } from "../utils/redisMatchHelper.js";
import { bullMQConnection } from "../config/redis.js";

const swipeWorkerHandler = async (job) => {
    const { userId, targetUserId, action, isMatch } = job.data;
    console.log(`[SwipeWorker] ⚙️ Processing ${action} from ${userId} to ${targetUserId}`);

    try {
        const now = new Date();

        // 1. Prepare Updates for my User
        let updateQuery = {};
        if (action === "left") {
            // ✅ Phase 4: Dislikes are Redis-only. We don't write them to MongoDB.
            console.log(`[SwipeWorker] 🏎️ Skipping MongoDB write for Dislike from ${userId}`);
            // Still update usage/lastSwipeDate below though
        } else {
            const updateField = action === "right" ? "likedUsers" : "superLikedUsers";
            updateQuery = { $addToSet: { [updateField]: targetUserId } };
            
            if (isMatch) {
                updateQuery.$addToSet.matches = targetUserId;
            }
        }
        
        // Update my usage in DB (Eventually consistent)
        updateQuery.$set = { "usage.lastSwipeDate": now };
        // We still increment in DB for long-term tracking, even if API uses Redis for limits
        updateQuery.$inc = { "usage.swipesCount": 1 };
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
            invalidateMatchesCache(userId, "swipe"),
            invalidateExploreCache(userId),
            ...invalidateCurrent,
            ...invalidateTarget,
        ]).catch((err) => console.error("[SwipeWorker] Invalidation error:", err));

        console.log(`✅ [SwipeWorker] Successfully persisted ${action} for ${userId}`);
        return { success: true };

    } catch (error) {
        console.error(`❌ [SwipeWorker] PERSISTENCE FAILED for ${userId}: ${error.message}`);
        throw error;
    }
};

const swipeWorker = new Worker("swipe-action-queue", swipeWorkerHandler, {
    connection: bullMQConnection,
    concurrency: 10 // Higher concurrency as these are simple DB writes
});

swipeWorker.on("completed", () => {
    // console.log(`[SwipeWorker] Job ${job.id} completed!`);
});

swipeWorker.on("failed", (job, err) => {
    console.error(`[SwipeWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [SwipeWorker] Worker Started & Listening...");

export default swipeWorker;
