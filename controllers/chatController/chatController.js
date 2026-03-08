import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import BlindSession from "../../models/BlindSession.js";
import GoDate from "../../models/GoDate.js";
import sanitizeHtml from "sanitize-html";
import { emitNotification } from "../../utils/notificationHelper.js";
import User from "../../models/User.js";
import { getDailyDmLimit } from "../../utils/subscriptionRules.js";
import { getMatchesCache, setMatchesCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";
import { messageQueue } from "../../config/queue.js"; 
import mongoose from "mongoose";

const INBOX_CACHE_TTL = 180; 
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

    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
    if (!text && !fileUrl) return res.status(400).json({ error: "Empty message" });

    // Allow both Cloudinary URLs and Base64 Data URLs for async processing
    if (fileUrl && !/^https:\/\/res\.cloudinary\.com\/.*/.test(fileUrl) && !/^data:/.test(fileUrl)) {
      return res.status(400).json({ error: "Invalid file URL. Only Cloudinary URLs or Data URLs are allowed." });
    }

    const cleanText = text
      ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
      : "";
      
    const sender = await User.findById(senderId).select(
      "usage subscription likedUsers likedBy blockedUsers blockedBy"
    ).lean();

    if (sender.blockedUsers?.some(id => id.toString() === receiverId) ||
        sender.blockedBy?.some(id => id.toString() === receiverId)) {
      return res.status(403).json({ error: "Cannot send message to this user" });
    }

    const now = new Date();
    const lastReset = sender.usage?.lastResetDate ? new Date(sender.usage.lastResetDate) : new Date(0);
    const isNextDay =
      now.getFullYear() !== lastReset.getFullYear() ||
      now.getMonth() !== lastReset.getMonth() ||
      now.getDate() !== lastReset.getDate();

    if (isNextDay) {
      await User.findByIdAndUpdate(senderId, {
         $set: { "usage.directMessagesCount": 0, "usage.lastResetDate": now }
      });
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    let isUnlocked = conversation?.isUnlocked === true;

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

    const isMatch =
      (sender.likedUsers || []).some((id) => id.toString() === receiverId.toString()) &&
      (sender.likedBy || []).some((id) => id.toString() === receiverId.toString());

    if (!isUnlocked && !isMatch) {
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

        if (!conversation || conversation.status !== "active") {
          const userPlan = sender.subscription?.plan || "free";
          const limit = getDailyDmLimit(userPlan);

          if (limit === 0) {
            return res.status(403).json({
              error: "Upgrade Required",
              message: "Direct Messages are for Gold/Platinum only.",
            });
          }

          if (limit !== Infinity) {
             const updatedSender = await User.findOneAndUpdate(
               { _id: senderId, "usage.directMessagesCount": { $lt: limit } },
               { $inc: { "usage.directMessagesCount": 1 } },
               { new: true }
             );
             if (!updatedSender) {
               return res.status(403).json({
                 error: "Limit Reached",
                 message: `Daily limit of ${limit} DMs reached.`,
               });
             }
          } else {
             await User.findByIdAndUpdate(senderId, { $inc: { "usage.directMessagesCount": 1 } });
          }
        }
    }

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
      await conversation.save(); 
    } else {
      let needsSave = false;
      if (isMatch && conversation.status !== "active") {
        conversation.status = "active";
        needsSave = true;
      }
      if (finalUnlocked && !conversation.isUnlocked) {
        conversation.isUnlocked = true;
        needsSave = true;
      }
      if (conversation.status === "active" && !conversation.matchType) {
        conversation.matchType = finalMatchType;
        needsSave = true;
      }
      if (needsSave) await conversation.save(); 
    }

    const messageId = new mongoose.Types.ObjectId();
    const newMessage = {
      _id: messageId,
      conversationId: conversation._id,
      sender: senderId,
      receiver: receiverId,
      text: cleanText,
      fileUrl: fileUrl || null,
      fileType: fileType || "text",
      parentMessage: parentMessage || null,
      isRead: false,
      createdAt: new Date(),
    };

    await messageQueue.add("process-message", {
      newMessage,
      senderId,
      receiverId,
      conversationId: conversation._id,
    });

    res.status(201).json(newMessage);
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

export const getConversations = async (req, res) => {
  try {
    const myId = String(req.user.userId || req.user.id);
    const { type = "active", cursor } = req.query;
    const cacheType = type === "requests" ? "conversations_requests" : "conversations_active";

    if (!cursor) {
        const cached = await getMatchesCache(myId, cacheType);
        if (cached) return res.status(200).json(cached);
    }

    const myIdObj = mongoose.Types.ObjectId.isValid(myId)
      ? new mongoose.Types.ObjectId(myId)
      : myId;

    let matchQuery = {
      participants: myIdObj,
      hiddenBy: { $ne: myIdObj },
    };

    if (type === "requests") {
      matchQuery.status = "pending";
      matchQuery.initiator = { $ne: myIdObj };
    } else {
      matchQuery.$or = [
        { status: "active" },
        { status: "pending", initiator: myIdObj },
      ];
    }
    
    if (cursor) {
         matchQuery.updatedAt = { $lt: new Date(cursor) };
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          let: { participantArray: "$participants" },
          pipeline: [
            { $match: { _id: myIdObj } },
            { $project: { blockedUsers: 1, blockedBy: 1 } }
          ],
          as: "meData"
        }
      },
      {
        $addFields: {
          blockedCombined: {
             $concatArrays: [
                { $ifNull: [{ $arrayElemAt: ["$meData.blockedUsers", 0] }, []] },
                { $ifNull: [{ $arrayElemAt: ["$meData.blockedBy", 0] }, []] }
             ]
          }
        }
      },
      {
        $match: {
          $expr: {
             $eq: [
               { $size: { $setIntersection: ["$participants", "$blockedCombined"] } },
               0
             ]
          }
        }
      },
      { $sort: { updatedAt: -1 } },
      { $limit: 10 }
    ];

    const conversations = await Conversation.aggregate(pipeline);
    await Conversation.populate(conversations, { path: "participants", select: "name avatar isOnline" });

    const conversationIds = conversations.map((c) => c._id);
    const unreadCounts = conversationIds.length > 0
         ? await Message.aggregate([
             { $match: { conversationId: { $in: conversationIds }, receiver: myIdObj, isRead: false, isDeleted: false } },
             { $group: { _id: "$conversationId", count: { $sum: 1 } } },
           ])
         : [];

    const unreadMap = {};
    unreadCounts.forEach((item) => {
      unreadMap[item._id.toString()] = item.count;
    });

    const conversationsWithUnread = conversations.map((conv) => ({
       ...conv,
       unreadCount: unreadMap[conv._id.toString()] || 0,
    }));

    if (!cursor) {
        await setMatchesCache(myId, cacheType, conversationsWithUnread, INBOX_CACHE_TTL);
    }

    res.status(200).json(conversationsWithUnread);
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error. Please try again later." });
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
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); 
    const skip = (pageNum - 1) * limitNum;

    const myObjId = mongoose.Types.ObjectId.isValid(myId) ? new mongoose.Types.ObjectId(myId) : myId;
    const otherObjId = mongoose.Types.ObjectId.isValid(otherUserId) ? new mongoose.Types.ObjectId(otherUserId) : otherUserId;

    const conversation = await Conversation.findOne({
      participants: { $all: [myObjId, otherObjId] }
    }).select("_id").lean();

    let messages = [];
    if (conversation) {
      messages = await Message.find({
        conversationId: conversation._id,
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip(skip)
        .lean();
    }

    res.status(200).json(messages);
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
  }
};

const UNREAD_COUNT_CACHE_TTL = 30;

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
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
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

    await Promise.all([
      invalidateMatchesCache(myId, "unread_count"),
      invalidateMatchesCache(myId, "conversations_active"),
      invalidateMatchesCache(myId, "conversations_requests")
    ]).catch(() => {});

    const io = req.app.get("io");
    io.to(otherUserId).emit("messages_seen", { seenBy: myId });

    res.status(200).json({ message: "Marked read" });
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You can only edit your own messages" });
    }

    message.text = text;
    message.isEdited = true;
    await message.save();

    io.to(message.receiver.toString())
      .to(message.sender.toString())
      .emit("message_edited", {
        id: message._id,
        text: message.text,
      });

    res.status(200).json(message);
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
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
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
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
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
  }
};

export const acceptRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.userId || req.user.id;
    const io = req.app.get("io");

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    if (conversation.initiator.toString() === userId.toString()) {
      return res.status(403).json({ error: "You cannot accept your own request" });
    }

    conversation.status = "active";
    await conversation.save();

    const senderId = conversation.initiator;
    invalidateInboxForUser(userId);
    invalidateInboxForUser(senderId.toString());

    io.to(senderId.toString()).emit("request_accepted", { conversationId });

    await emitNotification(io, senderId, {
      type: "REQUEST_ACCEPTED",
      senderId: userId,
      senderName: req.user.name || "User",
      senderAvatar: req.user.avatar || "",
      message: "Accepted your message request! 🎉",
      targetId: userId,
    });

    res.status(200).json({ message: "Request accepted", conversation });
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.userId || req.user.id;

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const isParticipant = conversation.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) return res.status(403).json({ error: "Not a participant" });
    if (conversation.initiator?.toString() === userId.toString()) {
      return res.status(403).json({ error: "You cannot reject your own request" });
    }

    const initiatorId = conversation.initiator?.toString?.();

    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversationId });

    if (userId) invalidateInboxForUser(userId);
    if (initiatorId) invalidateInboxForUser(initiatorId);

    res.status(200).json({ message: "Request rejected and deleted" });
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: "Server error" });
  }
};

export const hideConversation = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { conversationId } = req.body;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const isParticipant = conversation.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) return res.status(403).json({ error: "Not a participant" });

    const userIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    if (!conversation.hiddenBy) conversation.hiddenBy = [];
    if (conversation.hiddenBy.some((id) => id.toString() === userId.toString()))
      return res.status(200).json({ message: "Already hidden", conversation });

    conversation.hiddenBy.push(userIdObj);
    await conversation.save();

    invalidateInboxForUser(userId);

    res.status(200).json({ message: "Conversation hidden from your list" });
  } catch (error) { // eslint-disable-line no-unused-vars
    res.status(500).json({ error: "Server error" });
  }
};
