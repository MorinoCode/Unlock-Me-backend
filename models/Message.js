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
    isRead: { type: Boolean, default: false },
    parentMessage: {
      text: String,
      senderName: String,
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
