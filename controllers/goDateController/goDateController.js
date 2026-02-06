import GoDate from "../../models/GoDate.js";
import GoDateApply from "../../models/GoDateApply.js";
import User from "../../models/User.js";
import Chat from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import { emitNotification } from "../../utils/notificationHelper.js";
import cloudinary from "../../config/cloudinary.js";
import {
  getGoDateConfig,
  getGoDateApplyConfig,
} from "../../utils/subscriptionRules.js";
import mongoose from "mongoose"; // ✅ Critical Fix: For transactions
import {
  getMatchesCache,
  setMatchesCache,
  invalidateMatchesCache,
  invalidateGoDateCacheForUser,
  invalidateGoDateCacheForUsers,
} from "../../utils/cacheHelper.js";

const GO_DATE_CACHE_TTL = 300; // 5 min

const EXPIRED_THRESHOLD_MS = 5 * 60 * 1000;

const checkCreationLimit = async (user) => {
  const plan = user.subscription?.plan || "free";
  const userId = user._id;

  // ✅ Get Config from Central Rules
  const config = getGoDateConfig(plan);

  if (!config.canCreate) {
    return {
      allowed: false,
      message: "Your plan does not support creating dates.",
    };
  }

  // ✅ Diamond Plan: Unlimited - No limit check needed
  if (config.period === "unlimited") {
    return { allowed: true };
  }

  const now = new Date();
  let queryDate = new Date();

  // محاسبه بازه زمانی بر اساس کانفیگ
  if (config.period === "day") {
    queryDate.setHours(0, 0, 0, 0); // از اول امروز
  } else if (config.period === "week") {
    queryDate.setDate(now.getDate() - 7);
  } else if (config.period === "month") {
    queryDate.setDate(now.getDate() - 30);
  }

  const count = await GoDate.countDocuments({
    creator: userId,
    createdAt: { $gte: queryDate },
  });

  // چک کردن لیمیت (اگر روزانه است، لیمیت معمولا ۱ است، اگر هفته/ماه هم ۱ است)
  // فرض بر این است که لیمیت ۱ در هر دوره است (مگر اینکه در کانفیگ عدد خاصی باشد)
  const limitNumber = 1;

  if (count >= limitNumber) {
    return {
      allowed: false,
      message: `${plan} users limit: ${config.limitLabel}`,
    };
  }

  return { allowed: true };
};

export const createGoDate = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    const limitCheck = await checkCreationLimit(user);
    if (!limitCheck.allowed) {
      return res
        .status(403)
        .json({ error: "Limit Reached", message: limitCheck.message });
    }

    const {
      category,
      title,
      description,
      dateTime,
      city,
      generalArea,
      exactAddress,
      paymentType,
      genderPref,
      minAge,
      maxAge,
    } = req.body;

    let imageUrl = "";
    let imageId = "";

    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const uploadResponse = await cloudinary.uploader.upload(dataURI, {
        folder: "go_dates",
        format: "webp",
        transformation: [{ width: 800, height: 600, crop: "fill" }],
      });
      imageUrl = uploadResponse.secure_url;
      imageId = uploadResponse.public_id;
    }

    const newDate = new GoDate({
      creator: userId,
      category,
      title,
      description,
      dateTime,
      location: { city, generalArea, exactAddress },
      paymentType,
      preferences: {
        gender: genderPref || "other",
        minAge: minAge || 18,
        maxAge: maxAge || 99,
      },
      image: imageUrl,
      imageId: imageId,
    });

    await newDate.save();
    await invalidateGoDateCacheForUser(userId);
    await invalidateMatchesCache("global", `go_date_details_${newDate._id}`).catch(() => {});
    res.status(201).json(newDate);
  } catch (err) {
    console.error("Create GoDate Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getAvailableDates = async (req, res) => {
  try {
    const userId = req.user._id;
    const city = (req.query.city || "").trim().toLowerCase();
    const category = (req.query.category || "all").trim().toLowerCase();
    const cacheKey = `go_dates_browse_${city}_${category}`;

    const cached = await getMatchesCache(userId, cacheKey);
    if (cached) return res.json(cached);

    const userIdObj = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
    const now = Date.now();

    const expiredDates = await GoDate.find({
      status: "open",
      dateTime: { $lt: new Date(now - EXPIRED_THRESHOLD_MS) },
    });
    for (const date of expiredDates) {
      try {
        if (date.imageId) await cloudinary.uploader.destroy(date.imageId);
      } catch (_) {}
      await GoDate.findByIdAndDelete(date._id);
    }

    const query = {
      status: "open",
      dateTime: { $gt: new Date(now - EXPIRED_THRESHOLD_MS) },
      creator: { $ne: userIdObj },
    };

    if (city) {
      query["location.city"] = {
        $regex: new RegExp(`^${city}$`, "i"),
      };
    }
    if (category && category !== "all") {
      query.category = category;
    }

    const dates = await GoDate.find(query)
      .populate("creator", "name avatar age gender isVerified")
      .sort({ dateTime: 1 })
      .limit(50)
      .lean();

    const sanitizedDates = dates.map((date) => {
      const d = { ...date };
      if (d.location) delete d.location.exactAddress;
      d.hasApplied = (d.applicants || []).some(
        (id) => id && id.toString() === userId.toString()
      );
      return d;
    });

    await setMatchesCache(userId, cacheKey, sanitizedDates, GO_DATE_CACHE_TTL);
    res.json(sanitizedDates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getMyDates = async (req, res) => {
  try {
    const userId = req.user._id;
    const cached = await getMatchesCache(userId, "go_dates_mine");
    if (cached) return res.json(cached);

    const now = Date.now();

    const expiredDates = await GoDate.find({
      creator: userId,
      status: "open",
      dateTime: { $lt: new Date(now - EXPIRED_THRESHOLD_MS) },
    });
    for (const date of expiredDates) {
      if (date.imageId) await cloudinary.uploader.destroy(date.imageId);
      await GoDate.findByIdAndDelete(date._id);
    }

    const dates = await GoDate.find({ creator: userId })
      .populate("applicants", "name avatar age gender bio")
      .populate("acceptedUser", "name avatar")
      .sort({ createdAt: -1 });

    const list = Array.isArray(dates) ? dates : [];
    await setMatchesCache(userId, "go_dates_mine", list, GO_DATE_CACHE_TTL);
    res.json(list);
  } catch (err) {
    console.error("Get My Dates Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const applyForDate = async (req, res) => {
  // ✅ Critical Fix: Use MongoDB transaction to prevent race conditions
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { dateId } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    // ✅ Critical Fix: Use session for atomic read
    const date = await GoDate.findById(dateId).session(session);
    if (!date || date.status !== "open") {
      await session.abortTransaction();
      return res.status(404).json({ error: "Date not found or closed" });
    }

    // ✅ Critical Fix: Check if already applied atomically
    if (date.applicants.some((id) => id.toString() === userId.toString())) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Already applied" });
    }

    const currentUser = await User.findById(userId).session(session);

    // ✅ Apply limit per plan (anti-spam)
    const plan = currentUser.subscription?.plan || "free";
    const applyConfig = getGoDateApplyConfig(plan);
    if (applyConfig.maxPerDay !== Infinity) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const countToday = await GoDateApply.countDocuments({
        userId,
        createdAt: { $gte: startOfDay },
      }).session(session);
      if (countToday >= applyConfig.maxPerDay) {
        await session.abortTransaction();
        return res.status(403).json({
          error: "Apply limit reached",
          message: `You can apply to up to ${applyConfig.maxPerDay} dates per day. Try again tomorrow.`,
        });
      }
    }

    if (date.preferences) {
      if (
        date.preferences.gender &&
        date.preferences.gender !== "other" &&
        currentUser.gender !== date.preferences.gender
      ) {
        // Optional: Allow applies but warn, or Block. Here we block for strictness.
        // return res.status(400).json({ error: `Preference mismatch: Host prefers ${date.preferences.gender}` });
      }
    }

    // ✅ Critical Fix: Atomic update
    date.applicants.push(userId);
    await date.save({ session });
    await GoDateApply.create([{ userId, dateId }], { session });
    await session.commitTransaction();

    await invalidateGoDateCacheForUser(userId);
    await invalidateMatchesCache("global", `go_date_details_${dateId}`).catch(() => {});

    await emitNotification(io, date.creator, {
      type: "DATE_APPLICANT",
      senderId: userId,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar || "",
      message: `${currentUser.name} requested to join '${date.title}'!`,
      targetId: date._id,
    });

    res.json({ success: true });
  } catch (err) {
    await session.abortTransaction();
    console.error("Apply For Date Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  } finally {
    session.endSession();
  }
};

export const withdrawApplication = async (req, res) => {
  try {
    const { dateId } = req.body;
    const userId = req.user._id;

    const date = await GoDate.findById(dateId);
    if (!date) return res.status(404).json({ error: "Date not found" });

    date.applicants = date.applicants.filter(
      (id) => id.toString() !== userId.toString()
    );
    await date.save();
    await GoDateApply.deleteOne({ userId, dateId });
    await invalidateGoDateCacheForUser(userId);
    await invalidateMatchesCache("global", `go_date_details_${dateId}`).catch(() => {});

    res.json({ success: true, message: "Application withdrawn" });
  } catch (err) {
    console.error("Withdraw Application Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const acceptDateApplicant = async (req, res) => {
  // ✅ Critical Fix: Use MongoDB transaction to prevent race conditions
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { dateId, applicantId } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    // ✅ Critical Fix: Use session for atomic read
    const date = await GoDate.findById(dateId).session(session);

    if (!date) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Date not found" });
    }
    if (date.creator.toString() !== userId.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ error: "Not authorized" });
    }

    // ✅ بررسی دقیق وضعیت
    if (date.status !== "open") {
      await session.abortTransaction();
      return res.status(400).json({
        error: `Date is ${date.status}. You cannot accept applicants.`,
      });
    }

    // ✅ Critical Fix: Check if applicant exists atomically
    if (
      !date.applicants.some((id) => id.toString() === applicantId.toString())
    ) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ error: "Applicant not found in applicants list" });
    }

    // ✅✅✅ FIX LEGACY DATA:
    // اگر دیت قدیمی است و جنسیتش 'all' بوده، آن را به 'other' تغییر بده تا موقع ذخیره ارور ندهد
    if (date.preferences && date.preferences.gender === "all") {
      date.preferences.gender = "other";
    }

    // ✅ Critical Fix: Atomic update
    date.acceptedUser = applicantId;
    date.status = "closed";
    await date.save({ session });

    // ساخت یا آنلاک چت بین سازنده و کاربر پذیرفته‌شده (مثل Blind Date)
    let chat = await Chat.findOne({
      participants: { $all: [userId, applicantId] },
    }).session(session);

    if (!chat) {
      chat = new Chat({
        participants: [userId, applicantId],
        status: "active",
        initiator: userId,
        matchType: "go_date",
        isUnlocked: true,
      });
    } else {
      chat.status = "active";
      chat.matchType = "go_date";
      chat.isUnlocked = true;
    }
    await chat.save({ session });

    await session.commitTransaction();

    const creator = await User.findById(userId).select("name avatar");

    // ✅ ارسال خودکار آدرس و مشخصات دیت در چت برای کاربر پذیرفته‌شده
    const dateTimeFormatted = date.dateTime
      ? new Date(date.dateTime).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";
    const paymentLabel =
      date.paymentType === "me"
        ? "I pay"
        : date.paymentType === "you"
        ? "You pay"
        : "Split 50/50";
    const addressLine =
      date.location?.exactAddress ||
      [date.location?.generalArea, date.location?.city]
        .filter(Boolean)
        .join(", ") ||
      "";
    const detailsLines = [
      "📍 Date confirmed!",
      "",
      `📅 ${date.title || "Date"}`,
      `🕐 When: ${dateTimeFormatted}`,
      `📍 Address: ${addressLine}`,
      `🏙️ Area: ${date.location?.generalArea || ""}, ${
        date.location?.city || ""
      }`,
      `💳 Payment: ${paymentLabel}`,
    ];
    if (date.description?.trim()) {
      detailsLines.push("", `📝 ${date.description.trim()}`);
    }
    const detailsText = detailsLines.join("\n");

    const autoMessage = new Message({
      conversationId: chat._id,
      sender: userId,
      receiver: applicantId,
      text: detailsText,
      fileType: "text",
      isRead: false,
    });
    await autoMessage.save();

    chat.lastMessage = {
      text:
        detailsText.substring(0, 80) + (detailsText.length > 80 ? "..." : ""),
      sender: userId,
      createdAt: autoMessage.createdAt,
    };
    await chat.save();

    io.to(applicantId.toString()).emit("receive_message", autoMessage);

    await emitNotification(io, applicantId, {
      type: "DATE_ACCEPTED",
      senderId: userId,
      senderName: creator.name,
      senderAvatar: creator.avatar || "",
      message: `Your date request was accepted! Address & details are in the chat.`,
      targetId: chat._id,
    });

    // ✅ اطلاع به سایر متقاضیان: دیت بسته شد / شخص دیگری انتخاب شد
    const otherApplicantIds = date.applicants.filter(
      (id) => id.toString() !== applicantId.toString()
    );
    for (const otherId of otherApplicantIds) {
      await emitNotification(io, otherId, {
        type: "DATE_CLOSED_OTHER",
        senderId: userId,
        senderName: creator.name,
        senderAvatar: creator.avatar || "",
        message: `The date "${date.title}" is closed. Someone else was selected.`,
        targetId: dateId,
      });
    }

    await invalidateGoDateCacheForUsers([userId, applicantId]);
    await invalidateMatchesCache("global", `go_date_details_${dateId}`).catch(() => {});

    res.json({ success: true, chatRuleId: chat._id });
  } catch (err) {
    await session.abortTransaction();
    console.error("Accept Error:", err);
    // اگر ارور Validaton بود (مثل gender اشتباه)، جزئیات بده
    if (err.name === "ValidationError") {
      const errorMessage =
        process.env.NODE_ENV === "production"
          ? "Invalid data provided."
          : err.message;
      return res.status(400).json({ error: errorMessage });
    }
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  } finally {
    session.endSession();
  }
};

/** حداقل ۲۴ ساعت قبل از موعد دیت برای کنسلی */
const MIN_CANCEL_HOURS = 24;

/**
 * کنسلی دیت توسط سازنده (تا ۲۴ ساعت قبل از موعد).
 * اگر کسی قبول شده بود، به او نوتیف «دیت کنسل شد» ارسال می‌شود.
 */
export const cancelGoDate = async (req, res) => {
  try {
    const { dateId } = req.params;
    const userId = req.user._id;
    const io = req.app.get("io");

    const date = await GoDate.findById(dateId);
    if (!date) return res.status(404).json({ error: "Date not found" });
    if (date.creator.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (date.status === "cancelled") {
      return res.status(400).json({ error: "Date is already cancelled." });
    }

    const now = new Date();
    const dateTime = new Date(date.dateTime);
    const hoursLeft = (dateTime - now) / (1000 * 60 * 60);
    if (hoursLeft < MIN_CANCEL_HOURS) {
      return res.status(400).json({
        error: "Too late to cancel",
        message: `You can only cancel at least ${MIN_CANCEL_HOURS} hours before the date.`,
      });
    }

    date.status = "cancelled";
    await date.save();

    const creator = await User.findById(userId).select("name avatar");
    if (date.acceptedUser) {
      await emitNotification(io, date.acceptedUser, {
        type: "DATE_CANCELLED",
        senderId: userId,
        senderName: creator.name,
        senderAvatar: creator.avatar || "",
        message: `The date "${date.title}" has been cancelled by the host.`,
        targetId: dateId,
      });
      await invalidateGoDateCacheForUsers([userId, date.acceptedUser]);
    } else {
      await invalidateGoDateCacheForUser(userId);
    }
    await invalidateMatchesCache("global", `go_date_details_${dateId}`).catch(() => {});

    res.json({ success: true, message: "Date cancelled" });
  } catch (err) {
    console.error("Cancel GoDate Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const getGoDateDetails = async (req, res) => {
  try {
    const { dateId } = req.params;
    const userId = req.user._id;

    const cacheKey = `go_date_details_${dateId}`;
    const cached = await getMatchesCache("global", cacheKey);
    if (cached) return res.json(cached);

    const date = await GoDate.findById(dateId)
      .populate("creator", "name avatar age gender bio")
      .populate("applicants", "name avatar age gender bio")
      .populate("acceptedUser", "name avatar age gender bio")
      .lean();

    if (!date) return res.status(404).json({ error: "Date not found" });

    await setMatchesCache("global", cacheKey, date, GO_DATE_CACHE_TTL);
    res.json(date);
  } catch (err) {
    console.error("Get GoDate Details Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};

export const deleteGoDate = async (req, res) => {
  try {
    const { dateId } = req.params;
    const userId = req.user._id;

    const date = await GoDate.findById(dateId);

    if (!date) return res.status(404).json({ error: "Date not found" });

    if (date.creator.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (date.status === "closed" && date.acceptedUser) {
      return res.status(400).json({ error: "Cannot delete a confirmed date." });
    }
    if (date.status === "cancelled") {
      return res.status(400).json({ error: "Date is already cancelled." });
    }

    if (date.imageId) {
      await cloudinary.uploader.destroy(date.imageId);
    }

    await GoDate.findByIdAndDelete(dateId);
    await GoDateApply.deleteMany({ dateId });
    await invalidateGoDateCacheForUser(userId);
    await invalidateMatchesCache("global", `go_date_details_${dateId}`).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Delete GoDate Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ error: errorMessage });
  }
};
