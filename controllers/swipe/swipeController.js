import User from "../../models/User.js";
import { 
  calculateCompatibility, 
  calculateUserDNA, 
  generateMatchInsights 
} from "../../utils/matchUtils.js";
import { emitNotification } from "../../utils/notificationHelper.js";

export const getSwipeCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    
    const me = await User.findById(currentUserId);
    if (!me) return res.status(404).json({ message: "User not found" });

    const myCountry = me.location?.country;
    if (!myCountry) {
        return res.status(400).json({ 
            message: "Please set your location (Country) in profile settings first." 
        });
    }

    const excludeIds = [
      currentUserId,
      ...(me.likedUsers || []),
      ...(me.dislikedUsers || []),
      ...(me.superLikedUsers || [])
    ];

    let query = {
      _id: { $nin: excludeIds },
      "location.country": { $regex: new RegExp(`^${myCountry}$`, "i") }
    };

    if (me.lookingFor && me.lookingFor !== 'all') {
      query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
    }

    const candidates = await User.aggregate([
      { $match: query },
      { $sample: { size: 20 } } 
    ]);

    const enrichedCards = candidates.map(user => {
      const compatibility = calculateCompatibility(me, user);
      const dnaProfile = calculateUserDNA(user);
      const insights = generateMatchInsights(me, user);

      const commonInterest = user.interests?.find(i => me.interests?.includes(i));
      const icebreakerHint = commonInterest 
        ? `I noticed we both love ${commonInterest}! Tell me, what got you into it?` 
        : `Your bio caught my attention. ${user.bio?.substring(0, 50) || "Let's chat!"}`;

      return {
        _id: user._id,
        name: user.name,
        age: user.birthday?.year ? (new Date().getFullYear() - parseInt(user.birthday.year)) : 25,
        avatar: user.avatar,
        gallery: user.gallery || [],
        bio: user.bio,
        gender: user.gender,
        location: user.location,
        voiceIntro: user.voiceIntro || null, 

        matchScore: compatibility,   
        dna: dnaProfile,             
        insights: insights,
        icebreaker: icebreakerHint,  
        
        isPremiumCandidate: compatibility >= 90, 
      };
    });

    res.status(200).json(enrichedCards);

  } catch (error) {
    console.error("Swipe Cards Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const handleSwipeAction = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const { targetUserId, action } = req.body; 
    const io = req.app.get("io");

    // 1. Validation
    if (!targetUserId || !action) {
      return res.status(400).json({ message: "Invalid data: targetUserId and action are required." });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const currentUserData = await User.findById(currentUserId);
    if (!currentUserData) {
      return res.status(404).json({ message: "Current user not found" });
    }

    let isMatch = false;

    // 2. Processing Actions
    if (action === 'left') { 
      // Dislike logic
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { dislikedUsers: targetUserId }
      });
    } 
    else if (action === 'right' || action === 'up') {
      // Like or SuperLike logic
      const updateField = action === 'right' ? 'likedUsers' : 'superLikedUsers';
      
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { [updateField]: targetUserId }
      });

      // If it's a SuperLike, we also update the receiver's superLikedBy list
      if (action === 'up') {
        await User.findByIdAndUpdate(targetUserId, {
          $addToSet: { superLikedBy: currentUserId }
        });
      }

      // 3. Match Detection
      // Check if the target user has already liked or superliked the current user
      const hasLikedMe = (targetUser.likedUsers || []).includes(currentUserId.toString()) || 
                         (targetUser.superLikedUsers || []).includes(currentUserId.toString());

      if (hasLikedMe) {
        isMatch = true;

        // 4. Send Notifications for Match (Persistent & Real-time)
        
        // Notification to the Target User (the person who was swiped on)
        await emitNotification(io, targetUserId, {
          type: "MATCH",
          senderId: currentUserId,
          senderName: currentUserData.name,
          senderAvatar: currentUserData.avatar,
          message: "It's a Match! You both liked each other ❤️",
          targetId: currentUserId.toString() // Clicking leads to current user profile/chat
        });

        // Notification to the Current User (the person swiping)
        await emitNotification(io, currentUserId, {
          type: "MATCH",
          senderId: targetUserId,
          senderName: targetUser.name,
          senderAvatar: targetUser.avatar,
          message: "Congratulations! You have a new match 🔥",
          targetId: targetUserId.toString() // Clicking leads to target user profile/chat
        });
      }
    }

    // 5. Final Response
    res.status(200).json({ 
      success: true, 
      isMatch, 
      matchDetails: isMatch ? {
        name: targetUser.name,
        avatar: targetUser.avatar,
        id: targetUser._id
      } : null
    });

  } catch (error) {
    console.error("Error in handleSwipeAction:", error);
    res.status(500).json({ message: "Internal server error during swipe action." });
  }
};