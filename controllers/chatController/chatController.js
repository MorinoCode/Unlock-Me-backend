import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    const senderId = req.user.userId;
    const io = req.app.get("io");

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
      });
    }
    // ------------------------------------------

    const newMessage = new Message({
      conversationId: conversation._id,
      sender: senderId,
      receiver: receiverId,
      text,
    });

    await newMessage.save();

    conversation.lastMessage = { text, sender: senderId, createdAt: new Date() };
    await conversation.save();

    
    io.to(receiverId).emit("receive_message", newMessage); 

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("SendMessage Error:", error);
    res.status(500).json({ message: "Error sending message", error: error.message });
  }
};


export const getMessages = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const myId = req.user.userId;

    const conversation = await Conversation.findOne({
      participants: { $all: [myId, otherUserId] },
    });

    if (!conversation) return res.status(200).json([]);

    const messages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages", error: error.message });
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

    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ message: "Error fetching conversations", error: error.message });
  }
};