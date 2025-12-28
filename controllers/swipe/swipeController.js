import User from "../../models/User.js";
import { 
  calculateCompatibility, 
  calculateUserDNA, 
  generateMatchInsights 
} from "../../utils/matchUtils.js";

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

    if (!targetUserId || !action) return res.status(400).json({ message: "Invalid data" });

    const targetUser = await User.findById(targetUserId);

    if (!targetUser) return res.status(404).json({ message: "Target user not found" });

    let isMatch = false;

    if (action === 'left') { 
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { dislikedUsers: targetUserId }
      });
    }
    else if (action === 'right') { 
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { likedUsers: targetUserId }
      });
      const isLikedBack = (targetUser.likedUsers || []).includes(currentUserId) || (targetUser.superLikedUsers || []).includes(currentUserId);
      if (isLikedBack) isMatch = true;
    }
    else if (action === 'up') { 
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { superLikedUsers: targetUserId }
      });
      await User.findByIdAndUpdate(targetUserId, {
        $addToSet: { superLikedBy: currentUserId } 
      });
      const isLikedBack = (targetUser.likedUsers || []).includes(currentUserId) || (targetUser.superLikedUsers || []).includes(currentUserId);
      if (isLikedBack) isMatch = true;
    }

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
    console.error("Swipe Action Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};