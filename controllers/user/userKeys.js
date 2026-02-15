import User from "../../models/User.js";
import { getDailyKeyLimit } from "../../utils/subscriptionRules.js";

// @desc    Get key status (used, limit, remaining)
// @route   GET /api/user/keys/status
// @access  Private
export const getKeyStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("subscription usage");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Reset logic check (simple check, handled fully in middleware usually but good here too)
    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate || 0);
    const isSameDay =
      now.getDate() === lastReset.getDate() &&
      now.getMonth() === lastReset.getMonth() &&
      now.getFullYear() === lastReset.getFullYear();

    let keysUsed = user.usage.keysUsedToday || 0;

    // Optional: Real-time reset if needed (though typically this should be a middleware or cron)
    // For now, we trust the database value, assuming a cron job resets it, 
    // OR we implement a lazy-reset here:
    if (!isSameDay) {
        keysUsed = 0;
        // We don't save here to avoid side effects in a GET, 
        // but frontend will see 0. 
        // The actual reset happens on 'unlock' action.
    }

    const limit = getDailyKeyLimit(user.subscription.plan);
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - keysUsed);

    res.json({
      keysUsed,
      limit,
      remaining,
      plan: user.subscription.plan,
    });
  } catch (error) {
    console.error("ByKeyStatus Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Deduct key to unlock profile
// @route   POST /api/user/keys/unlock
// @access  Private
export const unlockProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 1. Check & Reset Daily Usage
    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate || 0);
    const isSameDay =
      now.getDate() === lastReset.getDate() &&
      now.getMonth() === lastReset.getMonth() &&
      now.getFullYear() === lastReset.getFullYear();

    if (!isSameDay) {
      user.usage.keysUsedToday = 0;
      user.usage.lastResetDate = now;
      // Also reset other daily counters if necessary, but focusing on keys here
    }

    // 2. Check Limit
    const limit = getDailyKeyLimit(user.subscription.plan);
    const currentUsage = user.usage.keysUsedToday || 0;

    if (limit !== Infinity && currentUsage >= limit) {
      return res.status(403).json({
        success: false,
        message: "Daily unlock limit reached. Upgrade your plan for more keys.",
        remaining: 0,
        limit,
      });
    }

    // 3. Deduct Key (Increment Usage) & Save Unlock
    user.usage.keysUsedToday = currentUsage + 1;
    
    // Check if targetUserId is provided
    const { targetUserId } = req.body;
    if (targetUserId) {
        // Use addToSet to avoid duplicates
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
      remaining: limit === Infinity ? Infinity : limit - user.usage.keysUsedToday,
    });
  } catch (error) {
    console.error("UnlockProfile Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};
