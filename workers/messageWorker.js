import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import redisClient from "../config/redis.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";
import cloudinary from "../config/cloudinary.js"; // ✅ Import Cloudinary

const invalidateInboxForUser = (userId) =>
  Promise.all([
    invalidateMatchesCache(userId, "conversations_active"),
    invalidateMatchesCache(userId, "conversations_requests"),
    invalidateMatchesCache(userId, "unread_count"),
  ]).catch((err) => console.error("Inbox cache invalidation error:", err));

const messageWorker = new Worker(
  "message-queue",
  async (job) => {
    try {
      const { newMessage, senderId, receiverId, conversationId } = job.data;

      // ✅ 1. Check if fileUrl is Base64 (starts with 'data:')
      // If it is, upload it to Cloudinary FIRST
      if (newMessage.fileUrl && newMessage.fileUrl.startsWith("data:")) {
        console.log(`[MessageWorker] Uploading Base64 ${newMessage.fileType} to Cloudinary...`);
        
        let uploadOptions = {
          folder: "unlock_me_chat_media",
          resource_type: newMessage.fileType === "audio" ? "video" : "auto",
        };

        // If it's audio, force mp3 format for better compatibility
        if (newMessage.fileType === "audio") {
          uploadOptions.format = "mp3";
        }

        const uploadRes = await cloudinary.uploader.upload(newMessage.fileUrl, uploadOptions);
        newMessage.fileUrl = uploadRes.secure_url; // Replace Base64 with Cloudinary URL
        console.log(`[MessageWorker] Cloudinary upload success: ${newMessage.fileUrl}`);
      }

      // 2. Save Message to MongoDB (Now with a real URL if it was Base64)
      const savedMessage = await Message.create(newMessage);

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
      
    } catch (error) {
       console.error("❌ Message Worker Error:", error);
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
  // console.log(`✅ Message Processed: ${job.id}`);
});

messageWorker.on("failed", (job, err) => {
  console.error(`❌ Message Queue Failed ${job?.id}:`, err.message);
});

console.log("👷 Message Queue Worker Running...");

export default messageWorker;
