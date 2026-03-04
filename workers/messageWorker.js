import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import redisClient from "../config/redis.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";

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

      // 1. Save Message to MongoDB
      const savedMessage = await Message.create(newMessage);

      // 2. Safely Update Conversation Last Message (Atomic)
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: {
          lastMessage: {
            text: newMessage.text || (newMessage.fileType === "image" ? "📷 Image" : "📄 File"),
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
