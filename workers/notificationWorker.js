import { Worker } from "bullmq";
import Notification from "../models/notification.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";

/**
 * Worker to process user notifications asynchronously.
 */
const workerHandler = async (job) => {
  const { receiverId, notificationData } = job.data;

  try {
    // 1. Save to Database
    const newNotification = new Notification({
      receiverId: receiverId,
      senderId: notificationData.senderId,
      senderName: notificationData.senderName,
      senderAvatar: notificationData.senderAvatar,
      type: notificationData.type,
      message: notificationData.message,
      targetId: notificationData.targetId,
    });

    const savedNotification = await newNotification.save();

    // 2. Invalidate Cache
    await invalidateMatchesCache(receiverId.toString(), "notifications").catch(() => {});

    // 3. Publish to Redis for Socket Emission (Horizontal Scaling)
    const message = JSON.stringify({
      type: "NEW_NOTIFICATION",
      userId: receiverId.toString(),
      notification: savedNotification,
    });
    await redisClient.publish("job-events", message);

    return { success: true, notificationId: savedNotification._id };
  } catch (error) {
    console.error("❌ [NotificationWorker] Error:", error);
    throw error;
  }
};

const notificationWorker = new Worker("notification-queue", workerHandler, {
  connection: bullMQConnection,
  concurrency: 20, // Process 20 notifications at once (Scalable!)
});

notificationWorker.on("completed", () => {
  // Silent success
});

notificationWorker.on("failed", (job, err) => {
  console.error(`🚨 [NotificationWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [NotificationWorker] Worker Started & Listening...");

export default notificationWorker;
