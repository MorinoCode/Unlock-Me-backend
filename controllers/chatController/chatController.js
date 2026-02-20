import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import BlindSession from "../../models/BlindSession.js";
import GoDate from "../../models/GoDate.js";
import sanitizeHtml from "sanitize-html";
import { emitNotification } from "../../utils/notificationHelper.js";
import User from "../../models/User.js";
import { getDailyDmLimit } from "../../utils/subscriptionRules.js";
import {
  getMatchesCache,
  setMatchesCache,
  invalidateMatchesCache,
} from "../../utils/cacheHelper.js";
import mongoose from "mongoose";

const INBOX_CACHE_TTL = 180; // 3 min
const invalidateInboxForUser = (userId) =>
  Promise.all([
    invalidateMatchesCache(userId, "conversations_active"),
    invalidateMatchesCache(userId, "conversations_requests"),
    invalidateMatchesCache(userId, "unread_count"),
  ]).catch((err) => console.error("Inbox cache invalidation error:", err));

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text, parentMessage, fileUrl, fileType } = req.body;
    const senderId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    if (!receiverId) {
      return res.status(400).json({ error: "receiverId is required" });
    }
    if (!text && !fileUrl) {
      return res.status(400).json({ error: "Empty message" });
    }

    const cleanText = text
      ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
      : "";
    const sender = await User.findById(senderId).select(
      "usage subscription likedUsers likedBy blockedUsers blockedBy"
    );

    // ✅ Block check: prevent messaging blocked users
    if (sender.blockedUsers?.some(id => id.toString() === receiverId) ||
        sender.blockedBy?.some(id => id.toString() === receiverId)) {
      return res.status(403).json({ error: "Cannot send message to this user" });
    }

    // --- Daily Reset Logic ---
    const now = new Date();
    const lastReset = sender.usage?.lastResetDate
      ? new Date(sender.usage.lastResetDate)
      : new Date(0);
    // ✅ Bug Fix #16: Added year check for daily reset
    const isNextDay =
      now.getFullYear() !== lastReset.getFullYear() ||
      now.getMonth() !== lastReset.getMonth() ||
      now.getDate() !== lastReset.getDate();

    if (isNextDay) {
      if (!sender.usage) sender.usage = {};
      sender.usage.directMessagesCount = 0;
      sender.usage.lastResetDate = now;
      await sender.save();
    }

    // --- 1. Find or Create Conversation Context First ---
    // We need to know if the conversation is unlocked BEFORE checking limits
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    // --- 2. Check Permissions (The Gatekeeper) ---
    // A chat is "Bypassed" (Free to chat) if it is explicitly unlocked (Go Date / Blind Date)
    let isUnlocked = conversation?.isUnlocked === true;

    // اگر آنلاک نبود، چک کن آیا با Blind Date یا Go Date مچ شدن → اجازه چت بده (رایگان)
    if (!isUnlocked) {
      const blindDateSession = await BlindSession.findOne({
        participants: { $all: [senderId, receiverId] },
        status: "completed",
      }).lean();
      if (blindDateSession) {
        isUnlocked = true;
        if (!conversation) {
          conversation = new Conversation({
            participants: [senderId, receiverId],
            status: "active",
            initiator: senderId,
            matchType: "blind_date",
            isUnlocked: true,
          });
          await conversation.save();
        } else {
          conversation.isUnlocked = true;
          conversation.matchType = "blind_date";
          conversation.status = "active";
          await conversation.save();
        }
      }
      // Go Date: اگر یکی سازنده و دیگری acceptedUser باشد → چت آنلاک
      if (!isUnlocked) {
        const goDateAccepted = await GoDate.findOne({
          status: "closed",
          $or: [
            { creator: senderId, acceptedUser: receiverId },
            { creator: receiverId, acceptedUser: senderId },
          ],
        }).lean();
        if (goDateAccepted) {
          isUnlocked = true;
          if (!conversation) {
            conversation = new Conversation({
              participants: [senderId, receiverId],
              status: "active",
              initiator: senderId,
              matchType: "go_date",
              isUnlocked: true,
            });
            await conversation.save();
          } else {
            conversation.isUnlocked = true;
            conversation.matchType = "go_date";
            conversation.status = "active";
            await conversation.save();
          }
        }
      }
    }

    // Check match status for standard flow
    // ✅ Critical Fix: Null check to prevent crash
    const isMatch =
      (sender.likedUsers || []).some(
        (id) => id.toString() === receiverId.toString()
      ) &&
      (sender.likedBy || []).some(
        (id) => id.toString() === receiverId.toString()
      );

    // If it's NOT unlocked, we must apply strict subscription rules
    if (!isUnlocked) {
      // If they are not a match, and not unlocked, check DM limits
      if (!isMatch) {
        // If conversation exists but is pending and sender started it -> Wait
        if (
          conversation &&
          conversation.status === "pending" &&
          conversation.initiator?.toString() === senderId.toString()
        ) {
          return res.status(403).json({
            error: "Request Pending",
            message: "Wait for acceptance.",
          });
        }

        // If no active conversation, check Plan Limits
        if (!conversation || conversation.status !== "active") {
          const userPlan = sender.subscription?.plan || "free";

          // Use the utility function for consistency
          const limit = getDailyDmLimit(userPlan);

          // Strict check for Free users on Direct Messages
          if (limit === 0) {
            return res.status(403).json({
              error: "Upgrade Required",
              message: "Direct Messages are for Gold/Platinum only.",
            });
          }

          // Check numeric limit for Gold/Platinum
          if (limit !== Infinity && sender.usage.directMessagesCount >= limit) {
            return res.status(403).json({
              error: "Limit Reached",
              message: `Daily limit of ${limit} DMs reached.`,
            });
          }

          // Increment usage if allowed
          sender.usage.directMessagesCount += 1;
          await sender.save();
        }
      }
    }

    // --- 3. Create or Update Conversation ---
    const initialStatus = isMatch ? "active" : "pending";
    const initialMatchType = isMatch ? "unlock" : "direct";
    const finalUnlocked = isUnlocked; 
    const finalMatchType = isUnlocked && !isMatch ? (conversation?.matchType || "blind_date") : initialMatchType;

    if (!conversation) {
      conversation = new Conversation({
        participants: [senderId, receiverId],
        initiator: senderId,
        matchType: finalMatchType,
        isUnlocked: finalUnlocked,
        status: initialStatus,
        hiddenBy: []
      });
      // We'll save it later after setting lastMessage
    } else {
      // Update existing conversation properties
      if (isMatch) conversation.status = "active";
      if (finalUnlocked) conversation.isUnlocked = true;
      // If it became a match or was recently unlocked via other means
      if (conversation.status === "active" && !conversation.matchType) {
        conversation.matchType = finalMatchType;
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
      isRead: false,
    });

    await newMessage.save();

    conversation.lastMessage = {
      text: cleanText || (fileType === "image" ? "📷 Image" : "📄 File"),
      sender: senderId,
      createdAt: new Date(),
    };

    // اگر گیرنده قبلاً چت را از لیستش حذف کرده بود، با پیام جدید دوباره در لیستش ظاهر شود
    if (conversation.hiddenBy?.length) {
      conversation.hiddenBy = conversation.hiddenBy.filter(
        (id) => id.toString() !== receiverId.toString()
      );
    }

    await conversation.save();

    invalidateInboxForUser(senderId);
    invalidateInboxForUser(receiverId);

    io.to(receiverId).emit("receive_message", newMessage);

    // نوتیف پیام فقط روی آیکون Messages نمایش داده می‌شود، در لیست نوتیفیکیشن ذخیره/ارسال نمی‌شود
    // (emitNotification برای چت فراخوانی نمی‌شود)

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("SendMessage Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getConversations = async (req, res) => {
  try {
    const myId = String(req.user.userId || req.user.id);
    const { type = "active" } = req.query;
    const cacheType = type === "requests" ? "conversations_requests" : "conversations_active";

    const cached = await getMatchesCache(myId, cacheType);
    if (cached) return res.status(200).json(cached);

    // مطابقت قطعی با participants (هم string هم ObjectId در دیتابیس)
    const myIdForQuery = mongoose.Types.ObjectId.isValid(myId)
      ? new mongoose.Types.ObjectId(myId)
      : myId;

    let query = {
      participants: myIdForQuery,
      hiddenBy: { $ne: myIdForQuery },
    };

    if (type === "requests") {
      // تب «Requests»: فقط پیام‌های pending که کاربر initiator نیست (یعنی برایش request آمده)
      query.status = "pending";
      query.initiator = { $ne: myIdForQuery };
    } else {
      // تب «Active Chats»: مکالمات active + پیام‌های ارسالی خودمان که منتظر تایید هستند
      query.$or = [
        { status: "active" },
        { status: "pending", initiator: myIdForQuery },
      ];
    }

    const conversations = await Conversation.find(query)
      .populate("participants", "name avatar isOnline")
      .sort({ updatedAt: -1 })
      .lean();

    // ✅ Bug Fix #18: Filter out conversations with blocked users
    const me = await User.findById(myId).select("blockedUsers blockedBy").lean();
    const blockedSet = new Set([
      ...(me?.blockedUsers || []).map(id => id.toString()),
      ...(me?.blockedBy || []).map(id => id.toString()),
    ]);
    const filteredConversations = blockedSet.size > 0
      ? conversations.filter(conv => {
          const otherParticipant = conv.participants?.find(
            (p) => (p._id || p).toString() !== myId
          );
          return otherParticipant && !blockedSet.has((otherParticipant._id || otherParticipant).toString());
        })
      : conversations;

    // ✅ Performance Fix: Batch count unread messages instead of N+1 queries
    const conversationIds = filteredConversations.map((c) => c._id);

    // Single aggregation query to get all unread counts
    const unreadCounts =
      conversationIds.length > 0
        ? await Message.aggregate([
            {
              $match: {
                conversationId: { $in: conversationIds },
                receiver: new mongoose.Types.ObjectId(myId),
                isRead: false,
                isDeleted: false,
              },
            },
            {
              $group: {
                _id: "$conversationId",
                count: { $sum: 1 },
              },
            },
          ])
        : [];

    // Create a map for O(1) lookup
    const unreadMap = {};
    unreadCounts.forEach((item) => {
      unreadMap[item._id.toString()] = item.count;
    });

    // Map conversations with unread counts
    const conversationsWithUnread = filteredConversations.map((conv) => ({
      ...conv,
      unreadCount: unreadMap[conv._id.toString()] || 0,
    }));

    await setMatchesCache(myId, cacheType, conversationsWithUnread, INBOX_CACHE_TTL);
    res.status(200).json(conversationsWithUnread);
  } catch (error) {
    console.error("Get Conversations Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getMessages = async (req, res) => {
  try {
    res.set({ "Cache-Control": "no-store" });

    const { otherUserId } = req.params;
    const myId = req.user.userId || req.user.id;

    if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ error: "Invalid chat user" });
    }

    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: otherUserId },
        { sender: otherUserId, receiver: myId },
      ],
      isDeleted: false, // ✅ Bug Fix: Don't show deleted messages
    })
      .sort({ createdAt: -1 }) // ✅ Performance Fix: Newest first
      .limit(limitNum)
      .skip(skip)
      .lean();

    res.status(200).json(messages);
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

const UNREAD_COUNT_CACHE_TTL = 30; // 30 sec

export const getUnreadMessagesCount = async (req, res) => {
  try {
    const myId = String(req.user.userId || req.user.id);
    const cached = await getMatchesCache(myId, "unread_count");
    if (cached !== null && typeof cached === "object" && "count" in cached) {
      return res.status(200).json(cached);
    }

    const myIdObj = mongoose.Types.ObjectId.isValid(myId)
      ? new mongoose.Types.ObjectId(myId)
      : myId;

    const visibleConversations = await Conversation.find({
      participants: myIdObj,
      hiddenBy: { $nin: [myIdObj] },
    })
      .select("_id")
      .lean();

    const conversationIds = visibleConversations.map((c) => c._id);
    let count = 0;
    if (conversationIds.length > 0) {
      count = await Message.countDocuments({
        conversationId: { $in: conversationIds },
        receiver: myIdObj,
        isRead: false,
        isDeleted: false,
      });
    }
    const payload = { count };
    await setMatchesCache(myId, "unread_count", payload, UNREAD_COUNT_CACHE_TTL);
    res.status(200).json(payload);
  } catch (error) {
    console.error("Get Unread Count Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production" ? "Server error." : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const myId = req.user.userId || req.user.id;

    if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ error: "Invalid chat user" });
    }

    await Message.updateMany(
      { sender: otherUserId, receiver: myId, isRead: false },
      { $set: { isRead: true } }
    );

    await invalidateMatchesCache(myId, "unread_count").catch(() => {});

    const io = req.app.get("io");
    io.to(otherUserId).emit("messages_seen", { seenBy: myId });

    res.status(200).json({ message: "Marked read" });
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    // ✅ Security Fix: Check message ownership before editing
    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You can only edit your own messages" });
    }

    message.text = text;
    message.isEdited = true;
    await message.save();
    const updatedMessage = message;

    io.to(updatedMessage.receiver.toString())
      .to(updatedMessage.sender.toString())
      .emit("message_edited", {
        id: updatedMessage._id,
        text: updatedMessage.text,
      });

    res.status(200).json(updatedMessage);
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // ✅ Security Fix: Check message ownership before deleting
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }

    message.isDeleted = true;
    message.text = "This message was deleted";
    await message.save();

    io.to(message.receiver.toString())
      .to(message.sender.toString())
      .emit("message_deleted", id);

    res.status(200).json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
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

    // ✅ Bug Fix: Use .toString() for ObjectId comparison
    const existingReaction = message.reactions.find((r) => r.userId?.toString() === userId.toString());

    if (existingReaction) {
      existingReaction.emoji = emoji;
    } else {
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    io.to(message.receiver.toString())
      .to(message.sender.toString())
      .emit("reaction_updated", {
        id: message._id,
        reactions: message.reactions,
      });

    res.status(200).json(message);
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const acceptRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation)
      return res.status(404).json({ error: "Conversation not found" });

    // Security: Only the receiver can accept
    if (conversation.initiator.toString() === userId.toString()) {
      return res
        .status(403)
        .json({ error: "You cannot accept your own request" });
    }

    conversation.status = "active";
    await conversation.save();

    const senderId = conversation.initiator;
    invalidateInboxForUser(userId);
    invalidateInboxForUser(senderId.toString());

    io.to(senderId.toString()).emit("request_accepted", { conversationId });

    // Notification
    await emitNotification(io, senderId, {
      type: "REQUEST_ACCEPTED",
      senderId: userId,
      senderName: req.user.name || "User",
      senderAvatar: req.user.avatar || "",
      message: "Accepted your message request! 🎉",
      targetId: userId,
    });

    res.status(200).json({ message: "Request accepted", conversation });
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.userId || req.user.id;

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // ✅ Security Fix: Only a participant (non-initiator) can reject
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: "Not a participant" });
    }
    if (conversation.initiator?.toString() === userId.toString()) {
      return res.status(403).json({ error: "You cannot reject your own request" });
    }

    const initiatorId = conversation.initiator?.toString?.();

    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversationId });

    if (userId) invalidateInboxForUser(userId);
    if (initiatorId) invalidateInboxForUser(initiatorId);

    res.status(200).json({ message: "Request rejected and deleted" });
  } catch (error) {
    console.error("Chat Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

/**
 * حذف چت از لیست برای کاربر جاری (استاندارد اپ‌های چت)
 * تاریخچه و مکالمه حذف نمی‌شود؛ فقط از لیست این کاربر پنهان می‌شود. طرف مقابل چت را می‌بیند.
 */
export const hideConversation = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { conversationId } = req.body;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation)
      return res.status(404).json({ error: "Conversation not found" });

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString()
    );
    if (!isParticipant)
      return res.status(403).json({ error: "Not a participant" });

    const userIdObj = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
    if (!conversation.hiddenBy) conversation.hiddenBy = [];
    if (conversation.hiddenBy.some((id) => id.toString() === userId.toString()))
      return res.status(200).json({ message: "Already hidden", conversation });

    conversation.hiddenBy.push(userIdObj);
    await conversation.save();

    invalidateInboxForUser(userId);

    res.status(200).json({ message: "Conversation hidden from your list" });
  } catch (error) {
    console.error("Hide Conversation Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production" ? "Server error." : error.message;
    res.status(500).json({ error: errorMessage });
  }
};
