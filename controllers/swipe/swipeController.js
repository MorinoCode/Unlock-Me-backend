import User from "../../models/User.js";
import { 
  calculateCompatibility, 
  calculateUserDNA, 
  generateMatchInsights 
} from "../../utils/matchUtils.js";
import { emitNotification } from "../../utils/notificationHelper.js";

// --- Helper Functions for Limits ---
const getSwipeLimit = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || 'free';
  switch (normalizedPlan) {
    case 'platinum': return Infinity; 
    case 'gold': return 80;
    case 'free': default: return 30;
  }
};

const getSuperLikeLimit = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || 'free';
  switch (normalizedPlan) {
    case 'platinum': return Infinity;
    case 'gold': return 5;
    case 'free': default: return 1;
  }
};

// ✅ Helper: Check if two dates are the same day (New)
const isSameDay = (d1, d2) => {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

// --- Get Cards (No Changes) ---
export const getSwipeCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const me = await User.findById(currentUserId).select("location interests lookingFor potentialMatches likedUsers dislikedUsers superLikedUsers dna");
    
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
      const preCalculatedMatch = me.potentialMatches?.find(
          m => m.user.toString() === user._id.toString()
      );

      let compatibility;
      if (preCalculatedMatch) {
          compatibility = preCalculatedMatch.matchScore;
      } else {
          compatibility = calculateCompatibility(me, user);
      }

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

// --- Handle Swipe Action (Updated Logic) ---
export const handleSwipeAction = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const { targetUserId, action } = req.body; 
    const io = req.app.get("io");

    // 1. Basic Validation
    if (!targetUserId || !action) {
      return res.status(400).json({ message: "Invalid data: targetUserId and action are required." });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) return res.status(404).json({ message: "Target user not found" });

    const currentUserData = await User.findById(currentUserId);
    if (!currentUserData) return res.status(404).json({ message: "Current user not found" });

    // 2. ✅ CHECK LIMITS & DAILY RESET LOGIC
    const userPlan = currentUserData.subscription?.plan || 'free';
    const swipeLimit = getSwipeLimit(userPlan);
    const superLikeLimit = getSuperLikeLimit(userPlan);

    const now = new Date();
    const lastSwipeDate = currentUserData.usage?.lastSwipeDate ? new Date(currentUserData.usage.lastSwipeDate) : null;

    // متغیرهای شمارنده فعلی
    let swipesToday = currentUserData.usage?.swipesCount || 0;
    let superLikesToday = currentUserData.usage?.superLikesCount || 0;
    
    // فلگ برای اینکه بفهمیم آیا امروز روز جدیدی است؟
    let isResetting = false;

    // اگر تاریخ آخرین سواپ وجود دارد و مال امروز نیست، یعنی روز جدید شده
    if (lastSwipeDate && !isSameDay(now, lastSwipeDate)) {
        isResetting = true;
        swipesToday = 0;      // ریست مجازی برای محاسبه
        superLikesToday = 0;  // ریست مجازی برای محاسبه
    }

    // الف) چک کردن محدودیت سواپ (چپ یا راست)
    if (action === 'right' || action === 'left') {
        if (swipeLimit !== Infinity && swipesToday >= swipeLimit) {
            return res.status(403).json({ 
                error: "Limit Reached", 
                message: "You have reached your daily swipe limit. Upgrade to continue!" 
            });
        }
    }

    // ب) چک کردن محدودیت سوپر لایک (بالا)
    if (action === 'up') {
        if (superLikeLimit !== Infinity && superLikesToday >= superLikeLimit) {
            return res.status(403).json({ 
                error: "Limit Reached", 
                message: "You have reached your daily Super Like limit. Upgrade for more!" 
            });
        }
    }

    let isMatch = false;
    let updateQuery = {};
    let finalUsageUpdate = {}; // برای استفاده در ساخت کوئری دیتابیس

    // 3. ✅ PROCESS ACTION & BUILD DB QUERY
    // اگر در حال ریست هستیم، باید مقادیر را با $set جایگزین کنیم (نه $inc)
    
    if (action === 'left') { 
      // Dislike
      updateQuery = { $addToSet: { dislikedUsers: targetUserId } };
      
      if (isResetting) {
          // روز جدید: سواپ میشه ۱، سوپر لایک میشه ۰، تاریخ آپدیت میشه
          finalUsageUpdate = { 
             "usage.swipesCount": 1, 
             "usage.superLikesCount": 0, 
             "usage.lastSwipeDate": now 
          };
          updateQuery["$set"] = finalUsageUpdate;
      } else {
          // روز جاری: سواپ +۱، تاریخ آپدیت
          updateQuery["$inc"] = { "usage.swipesCount": 1 };
          updateQuery["$set"] = { "usage.lastSwipeDate": now };
      }
    } 
    else if (action === 'right' || action === 'up') {
      const updateField = action === 'right' ? 'likedUsers' : 'superLikedUsers';
      updateQuery = { $addToSet: { [updateField]: targetUserId } };

      if (isResetting) {
         // روز جدید
         finalUsageUpdate = { 
             "usage.swipesCount": 1, 
             "usage.lastSwipeDate": now,
             "usage.superLikesCount": action === 'up' ? 1 : 0 
         };
         updateQuery["$set"] = finalUsageUpdate;
      } else {
         // روز جاری
         updateQuery["$set"] = { "usage.lastSwipeDate": now };
         
         // اگر سوپر لایک است، هم سواپ اضافه می‌شود هم سوپر لایک
         if (action === 'up') {
             updateQuery["$inc"] = { "usage.swipesCount": 1, "usage.superLikesCount": 1 };
         } else {
             updateQuery["$inc"] = { "usage.swipesCount": 1 };
         }
      }
    }

    // اعمال آپدیت روی دیتابیس
    await User.findByIdAndUpdate(currentUserId, updateQuery);

    // اگر سوپر لایک بود، در لیست طرف مقابل هم ثبت کن
    if (action === 'up') {
      await User.findByIdAndUpdate(targetUserId, {
        $addToSet: { superLikedBy: currentUserId }
      });
    }

    // 4. Match Detection
    if (action === 'right' || action === 'up') {
      const hasLikedMe = (targetUser.likedUsers || []).includes(currentUserId.toString()) || 
                         (targetUser.superLikedUsers || []).includes(currentUserId.toString());

      if (hasLikedMe) {
        isMatch = true;

        // Notifications
        await emitNotification(io, targetUserId, {
          type: "MATCH",
          senderId: currentUserId,
          senderName: currentUserData.name,
          senderAvatar: currentUserData.avatar,
          message: "It's a Match! You both liked each other ❤️",
          targetId: currentUserId.toString() 
        });

        await emitNotification(io, currentUserId, {
          type: "MATCH",
          senderId: targetUserId,
          senderName: targetUser.name,
          senderAvatar: targetUser.avatar,
          message: "Congratulations! You have a new match 🔥",
          targetId: targetUserId.toString() 
        });
      }
    }

    // 5. Response
    res.status(200).json({ 
      success: true, 
      isMatch, 
      matchDetails: isMatch ? {
        name: targetUser.name,
        avatar: targetUser.avatar,
        id: targetUser._id
      } : null,
      updatedUsage: {
          swipesCount: isResetting ? 1 : (swipesToday + 1),
          superLikesCount: action === 'up' ? (isResetting ? 1 : superLikesToday + 1) : (isResetting ? 0 : superLikesToday)
      }
    });

  } catch (error) {
    console.error("Error in handleSwipeAction:", error);
    res.status(500).json({ message: "Internal server error during swipe action." });
  }
};