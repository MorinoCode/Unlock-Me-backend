import User from "../../models/User.js";
import {
  calculateCompatibility,
  calculateUserDNA,
} from "../../utils/matchUtils.js";


export const handleLike = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.userId;

    if (myId === targetUserId)
      return res.status(400).json({ message: "You cannot like yourself" });

    await Promise.all([
      User.findByIdAndUpdate(myId, {
        $addToSet: { likedUsers: targetUserId },
      }),
      User.findByIdAndUpdate(targetUserId, {
        $addToSet: { likedBy: myId },
      }),
    ]);

    // 3. Optional: Check for a Match (if they already liked you)
    const targetUser = await User.findById(targetUserId);
    const isMatch = targetUser.likedUsers.includes(myId);

    res.status(200).json({
      message: "User liked successfully",
      isMatch: isMatch, // If true, you can trigger a "Match!" popup
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
      $addToSet: { dislikedUsers: targetUserId },
    });

    res.status(200).json({ message: "User disliked" });
  } catch (err) {
    res.status(500).json({ message: "Server error", err });
  }
};

export const getMatchesDashboard = async (req, res) => {
  try {
    const myId = req.user.userId;
    const me = await User.findById(myId);

    const selectFields =
      "name avatar location interests birthday questionsbycategoriesResults gender";

    const mutualMatches = await User.find({
      _id: { $in: me.likedUsers },
      likedUsers: myId,
    }).select(selectFields);

    const mutualIds = mutualMatches.map((m) => m._id);
    const sentLikes = await User.find({
      _id: { $in: me.likedUsers, $nin: mutualIds },
    }).select(selectFields);

    
    const incomingLikes = await User.find({
      likedUsers: myId,
      _id: { $nin: [...me.likedUsers, ...me.dislikedUsers, myId] },
    }).select(selectFields);

    // Function to process and add matchScore AND DNA to each user
    const processList = (list) =>
      list.map((user) => ({
        ...user.toObject(),
        matchScore: calculateCompatibility(me, user), // امتیاز دقیق
        dna: calculateUserDNA(user), // دیتای نمودار راداری
      }));

    res.status(200).json({
      mutualMatches: processList(mutualMatches),
      sentLikes: processList(sentLikes),
      incomingLikes: processList(incomingLikes),
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
