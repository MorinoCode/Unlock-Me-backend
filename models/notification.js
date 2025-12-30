import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // برای افزایش سرعت جستجو بر اساس کاربر
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: { type: String, required: true },
    senderAvatar: { type: String, default: "" },
    type: {
      type: String,
      enum: ["LIKE", "COMMENT", "MESSAGE", "MATCH", "NEW_MESSAGE", "NEW_COMMENT", "BLIND_MESSAGE", "REVEAL_SUCCESS"],
      required: true,
    },
    message: { type: String, required: true },
    targetId: { type: String }, 
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/**
 * اضافه کردن قابلیت حذف خودکار (TTL Index)
 * عدد 604800 معادل ۷ روز به ثانیه است (7 * 24 * 60 * 60)
 * مونگو دی‌بی به‌صورت خودکار فیلد createdAt را چک کرده و بعد از این زمان، رکورد را حذف می‌کند
 */
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;