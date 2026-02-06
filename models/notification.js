import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
      enum: [
        "LIKE",
        "COMMENT",
        "MESSAGE",
        "MATCH",
        "SUPER_LIKE",
        "NEW_MESSAGE",
        "NEW_COMMENT",
        "BLIND_MESSAGE",
        "REVEAL_SUCCESS",
        "DATE_APPLICANT",
        "DATE_ACCEPTED",
        "DATE_CANCELLED",
        "DATE_CLOSED_OTHER",
        "REQUEST_ACCEPTED",
        "NEW_REQUEST",
      ],
      required: true,
    },
    message: { type: String, required: true },
    targetId: { type: String },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });
notificationSchema.index({ receiverId: 1, isRead: 1 });
notificationSchema.index({ receiverId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
