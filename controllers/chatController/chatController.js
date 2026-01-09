import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import sanitizeHtml from 'sanitize-html';
import { emitNotification } from '../../utils/notificationHelper.js';
import User from "../../models/User.js";

const DM_LIMITS = { free: 0, gold: 5, platinum: 10 };

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text, parentMessage, fileUrl, fileType } = req.body;
    const senderId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    if (!text && !fileUrl) {
      return res.status(400).json({ error: "Cannot send empty message" });
    }

    const cleanText = text ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }) : "";

    // 1. گرفتن اطلاعات فرستنده (برای چک کردن محدودیت‌ها و مچ)
    const sender = await User.findById(senderId);

    // ==========================================
    // ✅ STEP A: Lazy Reset (ریست روزانه شمارنده‌ها)
    // ==========================================
    const now = new Date();
    // اگر lastResetDate وجود نداشت، یک تاریخ قدیمی بگذار
    const lastReset = sender.usage?.lastResetDate ? new Date(sender.usage.lastResetDate) : new Date(0);
    
    // چک می‌کنیم آیا روز تغییر کرده است؟
    const isNextDay = now.getDate() !== lastReset.getDate() || now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear();

    if (isNextDay) {
      if (!sender.usage) sender.usage = {}; 
      sender.usage.swipesCount = 0;
      sender.usage.superLikesCount = 0;
      sender.usage.directMessagesCount = 0;
      sender.usage.lastResetDate = now;
      await sender.save();
    }

    // ==========================================
    // ✅ STEP B: تشخیص وضعیت مچ (Match Check)
    // ==========================================
    // تعریف مچ: هم من او را لایک کرده‌ام، هم او مرا (در لیست‌های همدیگر هستیم)
    // نکته: در مدل یوزر شما این‌ها آرایه هستند
    const isMatch = sender.likedUsers.includes(receiverId) && sender.likedBy.includes(receiverId);

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] }
    });

    // اگر مچ نیستند (Direct Message Request)
    if (!isMatch) {
      
      // اگر قبلا پیامی داده و هنوز وضعیت pending است (قانون تک‌پیام)
      // شرط: کانورسیشن هست + وضعیت پندینگ است + شروع کننده من بودم
      if (conversation && conversation.status === 'pending' && conversation.initiator?.toString() === senderId.toString()) {
        return res.status(403).json({ 
          error: "Request Pending", 
          message: "Wait for them to accept your first message before sending more." 
        });
      }

      // اگر کانورسیشن کلا وجود ندارد (اولین پیام دایرکت)
      if (!conversation) {
        const userPlan = sender.subscription?.plan || 'free';
        const limit = DM_LIMITS[userPlan] || 0;

        // 1. اگر کاربر Free است
        if (userPlan === 'free') {
           return res.status(403).json({ error: "Upgrade Required", message: "Only Gold/Platinum members can send Direct Messages." });
        }
        
        // 2. چک کردن سقف روزانه
        if (sender.usage.directMessagesCount >= limit) {
          return res.status(403).json({ error: "Daily Limit Reached", message: `You reached your daily limit of ${limit} DMs.` });
        }

        // اگر مجاز بود، کنتور را زیاد کن و ذخیره کن
        sender.usage.directMessagesCount += 1;
        await sender.save();
      }
    }

    // ==========================================
    // ✅ STEP C: ساخت یا آپدیت کانورسیشن
    // ==========================================
    if (!conversation) {
      conversation = new Conversation({
        participants: [senderId, receiverId],
        // اگر مچ هستند Active، اگر نه Pending (ریکوئست)
        status: isMatch ? 'active' : 'pending',
        initiator: senderId
      });
    } else {
        // اگر قبلاً pending بوده ولی الان مچ شدند (مثلا وسط چت طرف لایک کرد)، فعالش کن
        if (isMatch && conversation.status === 'pending') {
            conversation.status = 'active';
        }
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

    // ارسال سوکت
    io.to(receiverId).emit("receive_message", newMessage);

    // ارسال نوتیفیکیشن
    await emitNotification(io, receiverId, {
      type: conversation.status === 'pending' ? "NEW_REQUEST" : "NEW_MESSAGE",
      senderId: senderId,
      senderName: req.user.name || "A user",
      senderAvatar: req.user.avatar,
      message: cleanText ? (cleanText.length > 40 ? cleanText.substring(0, 40) + "..." : cleanText) : "Sent a file",
      targetId: senderId 
    });

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("SendMessage Error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getConversations = async (req, res) => {
  try {
    const myId = req.user.userId || req.user.id;
    // ✅ فیلتر تایپ: 'active' (اینباکس) یا 'requests'
    const { type = 'active' } = req.query; 

    let query = { participants: myId };

    if (type === 'requests') {
        // درخواست‌ها: وضعیت pending باشد + من شروع کننده نباشم (گیرنده باشم)
        query.status = 'pending';
        query.initiator = { $ne: myId };
    } else {
        // اینباکس اصلی: 
        // 1. وضعیت active باشد
        // 2. یا وضعیت pending باشد ولی من فرستنده باشم (که ببینم پیام دادم) - اختیاری، معمولا active کافی است
        query.$or = [
            { status: 'active' },
            { status: 'pending', initiator: myId } // نمایش ریکوئست‌های ارسالی خودم در اینباکس
        ];
    }

    const conversations = await Conversation.find(query)
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
export const acceptRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    // امنیت: فقط گیرنده (کسی که initiator نیست) می‌تواند قبول کند
    if (conversation.initiator.toString() === userId.toString()) {
       return res.status(403).json({ error: "You cannot accept your own request" });
    }

    conversation.status = 'active';
    await conversation.save();

    // خبر دادن به فرستنده که درخواستش قبول شد
    const senderId = conversation.initiator;
    io.to(senderId.toString()).emit("request_accepted", { conversationId });
    
    // ارسال نوتیفیکیشن برای فرستنده
    await emitNotification(io, senderId, {
      type: "REQUEST_ACCEPTED",
      senderId: userId,
      senderName: req.user.name || "User", 
      message: "Accepted your message request! 🎉",
      targetId: userId
    });

    res.status(200).json({ message: "Request accepted", conversation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    
    // در ریجکت، معمولاً کل مکالمه را پاک می‌کنیم تا فضا اشغال نکند
    // یا می‌توانید status را به 'rejected' تغییر دهید
    await Conversation.findByIdAndDelete(conversationId);
    
    // همچنین پیام‌های داخلش را پاک کنیم
    await Message.deleteMany({ conversationId });

    res.status(200).json({ message: "Request rejected and deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};