import Notification from "../../models/notification.js";

/**
 * دریافت لیست نوتیفیکیشن‌های کاربر از دیتابیس
 * GET /api/notifications
 */
export const getNotifications = async (req, res) => {
  try {
    // در اکثر سیستم‌ها آیدی کاربر در req.user._id یا req.user.id است
    const userId = req.user._id || req.user.id || req.user.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized access" });
    }

    // پیدا کردن نوتیفیکیشن‌هایی که گیرنده‌اش این کاربر است
    const notifications = await Notification.find({ receiverId: userId })
      .sort({ createdAt: -1 }) // جدیدترین‌ها اول باشند
      .limit(20); // فقط ۲۰ مورد اخیر برای بهینه‌سازی سرعت

    res.status(200).json({ 
      success: true, 
      notifications 
    });
  } catch (error) {
    console.error("Error in getNotifications controller:", error.message);
    res.status(500).json({ error: "Internal server error" });
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

    // به جای آپدیت، آن را کلاً حذف می‌کنیم
    const deletedNotification = await Notification.findOneAndDelete({ 
      _id: id, 
      receiverId: userId 
    });

    if (!deletedNotification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.status(200).json({ success: true, message: "Notification read and deleted" });
  } catch (error) {
    res.status(500).json({ error });
  }
};