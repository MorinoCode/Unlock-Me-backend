import User from "../../models/User.js";

export const handleLike = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.userId;

    if (myId === targetUserId) return res.status(400).json({ message: "You cannot like yourself" });

    // 1. Add to my 'likedUsers' (using $addToSet to prevent duplicates)
    await User.findByIdAndUpdate(myId, {
      $addToSet: { likedUsers: targetUserId }
    });

    // 2. Add me to their 'likedBy'
    await User.findByIdAndUpdate(targetUserId, {
      $addToSet: { likedBy: myId }
    });

    // 3. Optional: Check for a Match (if they already liked you)
    const targetUser = await User.findById(targetUserId);
    const isMatch = targetUser.likedUsers.includes(myId);

    res.status(200).json({ 
      message: "User liked successfully", 
      isMatch: isMatch // If true, you can trigger a "Match!" popup
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", err });
  }
};

export const handleDislike = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.userId;

    await User.findByIdAndUpdate(myId, {
      $addToSet: { dislikedUsers: targetUserId }
    });

    res.status(200).json({ message: "User disliked" });
  } catch (err) {
    res.status(500).json({ message: "Server error" ,err});
  }
};