import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import redisClient from "../config/redis.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";
import cloudinary from "../config/cloudinary.js"; // ✅ Import Cloudinary
import { sendPush } from "../services/fcmService.js";
import User from "../models/User.js";

const invalidateInboxForUser = (userId) =>
  Promise.all([
    invalidateMatchesCache(userId, "conversations_active"),
    invalidateMatchesCache(userId, "conversations_requests"),
    invalidateMatchesCache(userId, "unread_count"),
  ]).catch((err) => logger.error("Inbox cache invalidation error:", err));

const messageWorker = new Worker(
  "message-queue",
  async (job) => {
    try {
      const { newMessage, senderId, receiverId, conversationId } = job.data;

      // ✅ 1. Check if fileUrl is Base64 (starts with 'data:')
      // If it is, upload it to Cloudinary using secure stream logic
      if (newMessage.fileUrl && newMessage.fileUrl.startsWith("data:")) {
        logger.info(`[MessageWorker] Uploading Base64 ${newMessage.fileType} to Cloudinary via stream...`);
        
        const base64Data = newMessage.fileUrl.split('base64,')[1];
        const audioBuffer = Buffer.from(base64Data, 'base64');

        const uploadPromise = new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              resource_type: newMessage.fileType === "audio" ? "video" : "auto",
              folder: "unlock_me_chat_media",
              format: newMessage.fileType === "audio" ? "mp3" : undefined,
            },
            (error, result) => error ? reject(error) : resolve(result)
          ).end(audioBuffer);
        });

        const uploadRes = await uploadPromise;
        newMessage.fileUrl = uploadRes.secure_url; // Replace Base64 with Cloudinary URL
        logger.info(`[MessageWorker] Cloudinary stream upload success: ${newMessage.fileUrl}`);
      }

      // 2. Update existing Message in MongoDB (Created by controller)
      const savedMessage = await Message.findByIdAndUpdate(
        newMessage._id,
        { $set: { fileUrl: newMessage.fileUrl } },
        { new: true }
      );
      
      if (!savedMessage) {
         throw new Error("Message not found in DB - controller failed to create it");
      }

      // 3. Safely Update Conversation Last Message (Atomic)
      let lastMsgText = newMessage.text;
      if (!lastMsgText) {
        if (newMessage.fileType === "image") lastMsgText = "📷 Image";
        else if (newMessage.fileType === "audio") lastMsgText = "🎤 Voice Message";
        else lastMsgText = "📄 File";
      }

      await Conversation.findByIdAndUpdate(conversationId, {
        $set: {
          lastMessage: {
            text: lastMsgText,
            sender: senderId,
            createdAt: newMessage.createdAt,
          }
        },
        $pull: { hiddenBy: receiverId } // Ensure the conversation reappears if hidden
      });

      // 3. Invalidate Redis Caches
      await invalidateInboxForUser(senderId);
      await invalidateInboxForUser(receiverId);
      
      // Invalidate specific chat caches so the initial load gets the new message
      await invalidateMatchesCache(senderId, `chat_${receiverId}`);
      await invalidateMatchesCache(receiverId, `chat_${senderId}`);

      // 4. Emit Sub/Pub notification for Sockets
      await redisClient.publish(
        "job-events",
        JSON.stringify({
          type: "NEW_CHAT_MESSAGE",
          userId: receiverId, // Triggers standard hook checks if needed
          receiverId,         // For custom socket routing
          senderId,
          message: savedMessage,
        })
      );

      // 5. Send FCM Push Notification
      try {
        const sender = await User.findById(senderId).select("name").lean();
        const senderName = sender ? sender.name : "Someone";
        
        await sendPush(receiverId, {
          title: `New message from ${senderName}`,
          body: lastMsgText, // Reusing atomic resolution from above (deals with images/audio)
          data: {
            type: "NEW_CHAT_MESSAGE",
            conversationId: conversationId.toString(),
            senderId: senderId.toString()
          }
        });
      } catch (pushErr) {
        logger.error("❌ Message Worker - FCM Push Error:", pushErr);
      }
      
    } catch (error) {
       logger.error("❌ Message Worker Error:", error);
       throw error;
    }
  },
  {
    connection: bullMQConnection,
    concurrency: 100, // HIGH concurrency for messaging
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  }
);

messageWorker.on("completed", () => {
  // logger.info(`✅ Message Processed: ${job.id}`);
});

messageWorker.on("failed", (job, err) => {
  logger.error(`❌ Message Queue Failed ${job?.id}:`, err.message);
});

logger.info("👷 Message Queue Worker Running...");

export default messageWorker;
