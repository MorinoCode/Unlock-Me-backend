import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import Notification from "../models/notification.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";
import { sendPush } from "../services/fcmService.js";

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

    // 4. Send FCM Push Notification
    let pushTitle = "New Notification";
    if (notificationData.type === "MATCH") pushTitle = "New Match! 🎉";
    else if (notificationData.type === "LIKE") pushTitle = "Someone liked you! ❤️";
    else if (notificationData.type === "SUPER_LIKE") pushTitle = "You got a Super Like! 🌟";
    else if (notificationData.type === "DATE_APPLICANT") pushTitle = "New Date Applicant! 📅";
    else if (notificationData.type === "DATE_ACCEPTED") pushTitle = "Date Accepted! 🥳";

    await sendPush(receiverId.toString(), {
      title: pushTitle,
      body: notificationData.message,
      data: {
        type: "NEW_NOTIFICATION",
        notificationType: notificationData.type,
        targetId: notificationData.targetId ? notificationData.targetId.toString() : "",
      }
    });

    return { success: true, notificationId: savedNotification._id };
  } catch (error) {
    logger.error("❌ [NotificationWorker] Error:", error);
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
  logger.error(`🚨 [NotificationWorker] Job ${job.id} failed: ${err.message}`);
});

logger.info("✅ [NotificationWorker] Worker Started & Listening...");

export default notificationWorker;
