import User from "../../models/User.js";

function calculateCompatibility(me, other) {
  let score = 0;
  
  
  const sharedInterests = me.interests.filter(i => other.interests.includes(i));
  score += Math.min(sharedInterests.length * 10, 30);

  
  if (me.location?.city === other.location?.city) {
    score += 20;
  }

  
  if (me.questionsbycategoriesResults?.categories && other.questionsbycategoriesResults?.categories) {
    
    score += 30;
  }

  return Math.min(score + Math.floor(Math.random() * 20), 100);
}
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

export const getMatchesDashboard = async (req, res) => {
  try {
    const myId = req.user.userId;
    const me = await User.findById(myId);

    // 1. Mutual Matches (Double Like)
    const mutualMatches = await User.find({
      _id: { $in: me.likedUsers },
      likedUsers: myId
    }).select("name avatar location interests birthday questionsbycategoriesResults");

    // 2. Sent Likes (Who I liked but haven't liked me back yet)
    const mutualIds = mutualMatches.map(m => m._id);
    const sentLikes = await User.find({
      _id: { $in: me.likedUsers, $nin: mutualIds }
    }).select("name avatar location interests birthday questionsbycategoriesResults");

    // 3. Incoming Likes (Who liked me but I haven't liked them back yet)
    // IMPORTANT: We exclude mutual matches AND people I already disliked
    const incomingLikes = await User.find({
      likedUsers: myId,
      _id: { $nin: [...me.likedUsers, ...me.dislikedUsers, myId] }
    }).select("name avatar location interests birthday questionsbycategoriesResults");

    // Function to process and add matchScore to each user
    const processList = (list) => list.map(user => ({
      ...user.toObject(),
      matchScore: calculateCompatibility(me, user) // Ensure this function is imported/available
    }));

    res.status(200).json({
      mutualMatches: processList(mutualMatches),
      sentLikes: processList(sentLikes),
      incomingLikes: processList(incomingLikes)
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};