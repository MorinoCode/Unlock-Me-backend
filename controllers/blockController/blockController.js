import User from "../../models/User.js";
import Conversation from "../../models/Conversation.js";

// ✅ Block a user
export const blockUser = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json({ message: "Target user ID is required" });
    }

    if (userId.toString() === targetUserId) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if already blocked
    const currentUser = await User.findById(userId);
    if (currentUser.blockedUsers?.some(id => id.toString() === targetUserId)) {
      return res.status(400).json({ message: "User is already blocked" });
    }

    // 1. Add to blockedUsers / blockedBy
    await User.findByIdAndUpdate(userId, {
      $addToSet: { blockedUsers: targetUserId },
      // Remove from all relationship arrays
      $pull: {
        likedUsers: targetUserId,
        likedBy: targetUserId,
        superLikedUsers: targetUserId,
        superLikedBy: targetUserId,
        matches: targetUserId,
      }
    });

    await User.findByIdAndUpdate(targetUserId, {
      $addToSet: { blockedBy: userId },
      $pull: {
        likedUsers: userId,
        likedBy: userId,
        superLikedUsers: userId,
        superLikedBy: userId,
        matches: userId,
      }
    });

    // 2. Hide conversation between the two users
    try {
      await Conversation.updateMany(
        {
          participants: { $all: [userId, targetUserId] }
        },
        {
          $addToSet: { hiddenBy: userId }
        }
      );
    } catch (e) {
      console.log("Conversation hide error:", e);
    }

    res.status(200).json({ message: "User blocked successfully" });
  } catch (error) {
    console.error("Block user error:", error);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? "Server error. Please try again later."
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ Unblock a user
export const unblockUser = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json({ message: "Target user ID is required" });
    }

    // Remove from blockedUsers / blockedBy
    await User.findByIdAndUpdate(userId, {
      $pull: { blockedUsers: targetUserId }
    });

    await User.findByIdAndUpdate(targetUserId, {
      $pull: { blockedBy: userId }
    });

    // Unhide conversation
    try {
      await Conversation.updateMany(
        {
          participants: { $all: [userId, targetUserId] }
        },
        {
          $pull: { hiddenBy: userId }
        }
      );
    } catch (e) {
      console.log("Conversation unhide error:", e);
    }

    res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("Unblock user error:", error);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? "Server error. Please try again later."
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ Get blocked users list
export const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;

    const user = await User.findById(userId)
      .populate("blockedUsers", "name username avatar")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ blockedUsers: user.blockedUsers || [] });
  } catch (error) {
    console.error("Get blocked users error:", error);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? "Server error. Please try again later."
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};
