import User from "../../models/User.js";



export const handleLike = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.userId;

    if (myId === targetUserId) {
      return res.status(400).json({ message: "You cannot like yourself" });
    }

    await Promise.all([
      User.findByIdAndUpdate(myId, {
        $addToSet: { likedUsers: targetUserId },
        $pull: { dislikedUsers: targetUserId }
      }),
      User.findByIdAndUpdate(targetUserId, {
        $addToSet: { likedBy: myId }
      }),
    ]);

    const targetUser = await User.findById(targetUserId).select("likedUsers");
    // ✅ Critical Fix: Null check to prevent crash
    const isMatch = (targetUser.likedUsers || []).some(id => id.toString() === myId.toString());

    res.status(200).json({
      message: "User liked successfully",
      isMatch: isMatch
    });
  } catch (err) {
    console.error("Handle Like Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const handleDislike = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.userId;

    if (myId === targetUserId) {
      return res.status(400).json({ message: "You cannot dislike yourself" });
    }

    await User.findByIdAndUpdate(myId, {
      $addToSet: { dislikedUsers: targetUserId },
      $pull: { likedUsers: targetUserId }
    });

    await User.findByIdAndUpdate(targetUserId, {
      $pull: { likedBy: myId }
    });

    res.status(200).json({ message: "User disliked successfully" });
  } catch (err) {
    console.error("Handle Dislike Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
