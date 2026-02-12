import cron from "node-cron";
import { godateQueue } from "../config/queue.js";

/**
 * ✅ GoDate Cleanup Cron
 * Schedules a background job to cleanup expired and accepted dates.
 * This ensures the browse list stays fresh without blocking user requests.
 */

// Run every 30 minutes
cron.schedule("*/30 * * * *", async () => {
    try {
        console.log("⏰ [GoDateCron] Scheduling CLENUP_EXPIRED job...");
        await godateQueue.add("cleanup-expired", { type: "CLEANUP_EXPIRED" }, {
            removeOnComplete: true,
            removeOnFail: 100,
            attempts: 1
        });
    } catch (err) {
        console.error("❌ [GoDateCron] Failed to schedule cleanup job:", err);
    }
});

console.log("✅ [GoDateCron] Cleanup scheduler initialized (30 min interval)");
