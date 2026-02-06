import Notification from "../../models/notification.js";
import { getMatchesCache, setMatchesCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";

const NOTIFICATIONS_CACHE_TTL = 120; // 2 min

/**
 * دریافت لیست نوتیفیکیشن‌های کاربر از دیتابیس
 * GET /api/notifications
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized access" });
    }

    const cached = await getMatchesCache(userId, "notifications");
    if (cached) return res.status(200).json(cached);

    const notifications = await Notification.find({ receiverId: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const payload = { success: true, notifications };
    await setMatchesCache(userId, "notifications", payload, NOTIFICATIONS_CACHE_TTL);
    res.status(200).json(payload);
  } catch (error) {
    console.error("Error in getNotifications controller:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * علامت‌گذاری یک نوتیفیکیشن به عنوان خوانده شده
 * PATCH /api/notifications/mark-read/:id
 */
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;

    const updated = await Notification.findOneAndUpdate(
      { _id: id, receiverId: userId },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const userIdForCache = req.user._id || req.user.id || req.user.userId;
    if (userIdForCache) invalidateMatchesCache(userIdForCache, "notifications").catch(() => {});

    res.status(200).json({ success: true, notification: updated });
  } catch (error) {
    console.error("Mark As Read Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * علامت‌گذاری همه نوتیفیکیشن‌ها به عنوان خوانده‌شده (برای وقتی کاربر درپدون را باز می‌کند)
 * PATCH /api/notifications/mark-all-read
 */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await Notification.updateMany(
      { receiverId: userId, isRead: false },
      { $set: { isRead: true } }
    );

    await invalidateMatchesCache(userId, "notifications").catch(() => {});

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark All As Read Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production" ? "Server error." : error.message;
    res.status(500).json({ error: errorMessage });
  }
};
