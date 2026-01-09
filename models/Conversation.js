import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastMessage: {
      text: String,
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      createdAt: { type: Date, default: Date.now },
      unreadCount: { type: Map, of: Number, default: {} }
    },
    status: {
      type: String,
      enum: ["active", "pending", "rejected"],
      default: "active", // برای چت‌های قدیمی که این فیلد را ندارند، فعال فرض می‌شود
    },
    
    // ✅ NEW: چه کسی شروع کننده بحث بوده؟ (برای اینکه بدانیم ریکوئست را به کی نشان دهیم)
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1 });

export default mongoose.model("Conversation", conversationSchema);