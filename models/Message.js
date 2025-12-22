import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: String,
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

export default mongoose.model("Message", messageSchema);
