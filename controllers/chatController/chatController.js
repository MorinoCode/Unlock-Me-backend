import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text, parentMessage } = req.body;
    const senderId = req.user.id; 

    const newMessage = new Message({
      sender: senderId,
      receiver: receiverId,
      text,
      parentMessage: parentMessage || null,
      isRead: false
    });

    await newMessage.save();

    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const myId = req.user.userId;

    // We must find messages where:
    // (Sender is ME AND Receiver is HIM) OR (Sender is HIM AND Receiver is ME)
    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: otherUserId },
        { sender: otherUserId, receiver: myId }
      ]
    }).sort({ createdAt: 1 }); // Sort by time ascending

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getConversations = async (req, res) => {
  try {
    const myId = req.user.userId;

    const conversations = await Conversation.find({
      participants: myId,
    })
      .populate("participants", "name avatar")
      .sort({ updatedAt: -1 });

    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          receiver: myId,
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

export const markAsRead = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const myId = req.user.userId;

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