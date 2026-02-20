import { notificationQueue } from "../config/queue.js";

/**
 * Enterprise emitNotification:
 * Offloads saving and emitting to BullMQ (notificationWorker)
 * to prevent main-thread bottlenecks.
 */
export const emitNotification = async (io, receiverId, notificationData) => {
  try {
    if (!receiverId) return;

    // Add to BullMQ Queue
    await notificationQueue.add("process-notification", {
      receiverId: receiverId.toString(),
      notificationData: {
        senderId: notificationData.senderId,
        senderName: notificationData.senderName,
        senderAvatar: notificationData.senderAvatar,
        type: notificationData.type,
        message: notificationData.message,
        targetId: notificationData.targetId,
      }
    }, {
      removeOnComplete: true,
      attempts: 3
    });

    console.log(`[Queue] Notification enqueued for user: ${receiverId}`);
  } catch (error) {
    console.error("Error enqueuing notification:", error);
  }
};
