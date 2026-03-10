import { getFirebaseAdmin } from "../config/firebase.js";
import User from "../models/User.js";
import Notification from "../models/notification.js";
import Message from "../models/Message.js";
import mongoose from "mongoose";

/**
 * Enterprise Helper to dispatch Push Notifications using FCM.
 * @param {Array<string>|string} userIds - Recipient User ID(s)
 * @param {Object} payload - Notification payload { title, body, data }
 */
export const sendPush = async (userIds, payload) => {
  const admin = getFirebaseAdmin();
  if (!admin) {
    console.warn("⚠️ [FCM] Firebase not initialized. Skipping Push Notification.");
    return false;
  }

  try {
    // Normalize userIds to an array of Mongo ObjectIds
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    const objectIds = ids
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    if (objectIds.length === 0) return false;

    // Fetch users with their FCM tokens
    const users = await User.find({ _id: { $in: objectIds } })
      .select("_id fcmTokens")
      .lean();

    const messages = [];

    for (const user of users) {
      if (!user.fcmTokens || user.fcmTokens.length === 0) {
        continue; // Skip silently if the user has no tokens (Web users)
      }

      // Calculate Badge Logic (Unread Messages + Unread Notifications)
      const unreadNotificationsCount = await Notification.countDocuments({
        receiverId: user._id,
        isRead: false,
      });

      const unreadMessagesCount = await Message.countDocuments({
        receiver: user._id,
        isRead: false,
        isDeleted: false,
      });

      const totalBadgeCount = unreadNotificationsCount + unreadMessagesCount;

      // Construct Multicast Message for this specific user's devices
      const message = {
        notification: {
          title: payload.title || "Unlock Me",
          body: payload.body || "You have a new notification",
        },
        android: {
          notification: {
            channelId: "default", // Must match the channel ID configured in Frontend Capacitor setup later
            sound: "default"
          }
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              badge: totalBadgeCount,
            }
          }
        },
        data: {
          ...payload.data, // Custom routing payload (e.g., type: "NEW_MESSAGE", conversationId: "123")
          senderId: payload.data?.senderId ? payload.data.senderId.toString() : "",
          badge: totalBadgeCount.toString() // Stringified for data payload
        },
        tokens: user.fcmTokens,
      };

      messages.push(message);
    }

    if (messages.length === 0) return false;

    // Dispatch Multicast Messages
    // Note: To optimize, since we map different badges to different users, we loop Multicasts per User.
    const sendPromises = messages.map(msg => admin.messaging().sendEachForMulticast(msg));
    
    const responses = await Promise.allSettled(sendPromises);

    for (const [index, result] of responses.entries()) {
      if (result.status === 'fulfilled') {
        const response = result.value;
        if (response.failureCount > 0) {
          // Identify failing tokens (e.g., Dead tokens)
          const failedTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              failedTokens.push(messages[index].tokens[idx]);
              console.warn(`[FCM] Token failure: ${resp.error?.code}`);
            }
          });
          
          // Clean up dead tokens from the database asynchronously
          if (failedTokens.length > 0) {
             console.log(`🧹 [FCM] Cleaning up ${failedTokens.length} dead tokens`);
             // Implementation for cleanup could be added here later (update User document removing these tokens)
             // We skip implementing the DB pull here to keep this purely a sender, 
             // but it's an important architectural note.
          }
        }
      } else {
         console.error(`❌ [FCM] Multicast Send Error:`, result.reason);
      }
    }

    return true;

  } catch (error) {
    console.error("❌ [FCM Service] Fatal Error sending Push:", error);
    return false;
  }
};
