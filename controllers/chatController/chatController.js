import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import sanitizeHtml from 'sanitize-html';
import { emitNotification } from '../../utils/notificationHelper.js';

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text, parentMessage, fileUrl, fileType } = req.body;
    const senderId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    if (!text && !fileUrl) {
      return res.status(400).json({ error: "Cannot send empty message" });
    }

    const cleanText = text ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }) : "";

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] }
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [senderId, receiverId]
      });
    }

    const newMessage = new Message({
      conversationId: conversation._id,
      sender: senderId,
      receiver: receiverId,
      text: cleanText,
      fileUrl: fileUrl || null,
      fileType: fileType || "text",
      parentMessage: parentMessage || null,
      isRead: false
    });

    await newMessage.save();

    conversation.lastMessage = {
      text: cleanText || (fileType === "image" ? "📷 Image" : "📄 File"),
      sender: senderId,
      createdAt: new Date()
    };
    
    await conversation.save();

    // Emit standard chat event (existing logic)
    io.to(receiverId).emit("receive_message", newMessage);

    // Emit Real-time Notification for New Message
    emitNotification(io, receiverId, {
      type: "NEW_MESSAGE",
      senderName: req.user.name || "A user",
      senderAvatar: req.user.avatar,
      message: cleanText ? (cleanText.length > 40 ? cleanText.substring(0, 40) + "..." : cleanText) : "Sent a file",
      targetId: senderId // Clicking notification leads to chat with sender
    });

    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getConversations = async (req, res) => {
  try {
    const myId = req.user.userId || req.user.id;

    const conversations = await Conversation.find({
      participants: myId,
    })
      .populate("participants", "name avatar isOnline")
      .sort({ updatedAt: -1 });

    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser = conv.participants.find(p => p._id.toString() !== myId.toString());
        
        const unreadCount = await Message.countDocuments({
          receiver: myId,
          sender: otherUser ? otherUser._id : null,
          isRead: false,
        });

        return {
          ...conv.toObject(),
          unreadCount,
        };
      })
    );

    res.status(200).json(conversationsWithUnread);
  } catch (error) {
    res.status(500).json({ message: "Error", error: error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store",
    });
    const { otherUserId } = req.params;
    const myId = req.user.userId || req.user.id;

    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: otherUserId },
        { sender: otherUserId, receiver: myId }
      ]
    }).sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const myId = req.user.userId || req.user.id;

    await Message.updateMany(
      { sender: otherUserId, receiver: myId, isRead: false },
      { $set: { isRead: true } }
    );

    const io = req.app.get("io");
    io.to(otherUserId).emit("messages_seen", { seenBy: myId });

    res.status(200).json({ message: "Messages marked as read" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const io = req.app.get("io");

    const updatedMessage = await Message.findByIdAndUpdate(
      id,
      { text, isEdited: true },
      { new: true }
    );

    io.to(updatedMessage.receiver.toString()).to(updatedMessage.sender.toString()).emit("message_edited", {
      id: updatedMessage._id,
      text: updatedMessage.text
    });

    res.status(200).json(updatedMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get("io");

    const message = await Message.findById(id);
    message.isDeleted = true;
    message.text = "This message was deleted";
    await message.save();

    io.to(message.receiver.toString()).to(message.sender.toString()).emit("message_deleted", id);

    res.status(200).json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    const userId = req.user.userId || req.user.id; 
    const io = req.app.get("io");

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: "Message not found" });

    const existingReaction = message.reactions.find(r => r.userId === userId);

    if (existingReaction) {
      existingReaction.emoji = emoji;
    } else {
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    io.to(message.receiver.toString()).to(message.sender.toString()).emit("reaction_updated", {
      id: message._id,
      reactions: message.reactions
    });

    res.status(200).json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};