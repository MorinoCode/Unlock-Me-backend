import Notification from "../models/notification.js";

/**
 * Optimized emitNotification:
 * 1. Saves to Database (for offline support)
 * 2. Emits via Socket (for real-time updates)
 */
export const emitNotification = async (io, receiverId, notificationData) => {
  try {
    // ۱. ذخیره در دیتابیس (بسیار مهم برای دریافت نوتیفیکیشن‌های قدیمی هنگام ورود)
    const newNotification = new Notification({
      receiverId: receiverId,
      senderId: notificationData.senderId,
      senderName: notificationData.senderName,
      senderAvatar: notificationData.senderAvatar,
      type: notificationData.type,
      message: notificationData.message,
      targetId: notificationData.targetId,
    });

    const savedNotification = await newNotification.save();

    const { invalidateMatchesCache } = await import("../utils/cacheHelper.js");
    await invalidateMatchesCache(receiverId.toString(), "notifications").catch(() => {});

    // ۲. ارسال از طریق سوکت
    // ما از room استفاده می‌کنیم چون در سمت فرانت، کاربر هنگام اتصال به اتاقی با نام userId خودش join می‌شود
    if (io) {
      io.to(receiverId.toString()).emit("new_notification", savedNotification);
      console.log(`Notification emitted to room: ${receiverId}`);
    }

    return savedNotification;
  } catch (error) {
    console.error("Error in emitNotification Helper:", error);
  }
};