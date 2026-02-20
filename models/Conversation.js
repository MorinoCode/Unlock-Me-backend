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
      unreadCount: { type: Map, of: Number, default: {} },
    },
    status: {
      type: String,
      enum: ["active", "pending", "rejected"],
      default: "active",
    },
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    matchType: {
      type: String,
      enum: ["unlock", "blind_date", "direct", "go_date"],
      default: "direct",
    },
    isUnlocked: {
      type: Boolean,
      default: false,
    },
    // کاربرانی که این چت را از لیست خود حذف کرده‌اند (تاریخچه برای طرف مقابل باقی می‌ماند)
    hiddenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// ✅ Performance Fix: Optimized indexes
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ "lastMessage.createdAt": -1 });
conversationSchema.index({ status: 1, updatedAt: -1 });
conversationSchema.index({ hiddenBy: 1 });
// ✅ Improvement #25: Compound index for getConversations query
conversationSchema.index({ participants: 1, status: 1, hiddenBy: 1 });

export default mongoose.model("Conversation", conversationSchema);
