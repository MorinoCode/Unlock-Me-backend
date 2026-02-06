import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true 
    },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, trim: true },
    fileUrl: String,
    fileType: {
      type: String,
      enum: ["image", "video", "audio", "file", "text"],
      default: "text",
    },
    isRead: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    reactions: [
      {
        userId: String,
        emoji: String,
      },
    ],
    parentMessage: {
      text: String,
      senderName: String,
      messageId: String,
    },
  },
  { timestamps: true }
);

// ✅ Performance Fix: Optimized indexes
messageSchema.index({ conversationId: 1, createdAt: -1 }); // Changed to -1 for descending
messageSchema.index({ sender: 1, createdAt: -1 }); // For sender queries
messageSchema.index({ receiver: 1, isRead: 1 }); // For unread messages
messageSchema.index({ isDeleted: 1 }); // For filtering deleted messages
// ✅ Performance Fix: Compound index for unread count queries (conversationId + receiver + isRead)
messageSchema.index({ conversationId: 1, receiver: 1, isRead: 1 });

export default mongoose.model("Message", messageSchema);