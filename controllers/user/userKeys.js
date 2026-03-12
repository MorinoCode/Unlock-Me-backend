import User from "../../models/User.js";
import { getDailyKeyLimit } from "../../utils/subscriptionRules.js";

export const getKeyStatus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const user = await User.findById(userId).select("subscription usage");
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate || 0);
    const isSameDay =
      now.getDate() === lastReset.getDate() &&
      now.getMonth() === lastReset.getMonth() &&
      now.getFullYear() === lastReset.getFullYear();

    let keysUsed = user.usage.keysUsedToday || 0;

    if (!isSameDay) {
        keysUsed = 0;
    }

    const limit = getDailyKeyLimit(user.subscription.plan);
    const remaining = limit === -1 ? -1 : Math.max(0, limit - keysUsed);

    res.json({
      keysUsed,
      limit,
      remaining,
      plan: user.subscription.plan,
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

export const unlockProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate || 0);
    const isSameDay =
      now.getDate() === lastReset.getDate() &&
      now.getMonth() === lastReset.getMonth() &&
      now.getFullYear() === lastReset.getFullYear();

    if (!isSameDay) {
      user.usage.keysUsedToday = 0;
      user.usage.lastResetDate = now;
    }

    const limit = getDailyKeyLimit(user.subscription.plan);
    const currentUsage = user.usage.keysUsedToday || 0;

    if (limit !== -1 && currentUsage >= limit) {
      return res.status(403).json({
        success: false,
        message: "Daily unlock limit reached. Upgrade your plan for more keys.",
        remaining: 0,
        limit,
      });
    }

    user.usage.keysUsedToday = currentUsage + 1;
    
    const { targetUserId } = req.body;
    if (targetUserId) {
        if (!user.unlockedProfiles) user.unlockedProfiles = [];
        if (!user.unlockedProfiles.includes(targetUserId)) {
             user.unlockedProfiles.push(targetUserId);
        }
    }
    
    await user.save();

    res.json({
      success: true,
      message: "Key used successfully",
      keysUsed: user.usage.keysUsedToday,
      remaining: limit === -1 ? -1 : limit - user.usage.keysUsedToday,
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};
