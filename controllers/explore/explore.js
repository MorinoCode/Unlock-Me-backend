import User from "../../models/User.js";
import { calculateCompatibility, calculateUserDNA, getUserVisibilityThreshold, shuffleArray } from "../../utils/matchUtils.js";

// export const getExploreMatches = async (req, res) => {
//   try {
//     const { country } = req.query;
//     const currentUserId = req.user.userId;

//     // 1. دریافت اطلاعات کاربر فعلی (من)
//     const me = await User.findById(currentUserId);
//     if (!me) return res.status(404).json({ message: "User not found" });

//     // 2. کوئری برای پیدا کردن بقیه کاربران در همین کشور
//     const query = {
//       _id: { $ne: currentUserId },
//       "location.country": { $regex: new RegExp(`^${country}$`, "i") }
//     };

//     if (me.lookingFor) {
//       query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
//     }

//     // دریافت کاربران (lean برای سرعت بیشتر)
//     const allMatches = await User.find(query)
//       .select("name avatar bio interests location birthday questionsbycategoriesResults subscription gender createdAt")
//       .lean();

//     // 3. محاسبه امتیاز و DNA برای همه
//     const processedUsers = allMatches.map(user => {
//       const matchScore = calculateCompatibility(me, user);
//       const dna = calculateUserDNA(user);
//       return { ...user, matchScore, dna };
//     });

//     // 4. دسته‌بندی لیست‌ها

//     // الف) Soulmates (فقط بالای 80 درصد)
//     const soulmatesList = processedUsers
//       .filter(u => u.matchScore >= 80)
//       .sort((a, b) => b.matchScore - a.matchScore);

//     const othersList = processedUsers.filter(u => u.matchScore < 80);

//     // ب) Fresh Faces (۱۰ نفر جدیدتر از لیست others)
//     const freshFaces = [...othersList]
//       .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
//       .slice(0, 10);

//     // ج) Near You (اصلاح شده: همه همشهری‌ها را نشان بده، حتی اگر امتیاز بالا دارند)
//     const myCityNorm = me.location?.city?.toLowerCase().trim();
    
//     const cityMatches = processedUsers // ⚠️ از processedUsers استفاده کردیم نه othersList
//       .filter(u => u.location?.city?.toLowerCase().trim() === myCityNorm)
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // د) Common Interests
//     const interestMatches = othersList
//       .filter(u => u.interests.some(i => me.interests.includes(i)))
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // ه) Across the Country
//     const countryMatches = othersList
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // 5. ارسال پاسخ نهایی با فرمت جدید
//     res.status(200).json({
//       // اگر کاربر پلن نداشت، دیفالت free بگذار
//       userPlan: me.subscription?.plan || "free", 
//       sections: {
//         soulmates: soulmatesList,
//         freshFaces: freshFaces,
//         cityMatches: cityMatches,
//         interestMatches: interestMatches,
//         countryMatches: countryMatches
//       }
//     });

//   } catch (err) {
//     console.error("Explore Error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };
// export const getMatchesDashboard = async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id)
//       .populate("likedUsers", "name avatar location birthday bio matchScore")
//       .populate("likedBy", "name avatar location birthday bio matchScore");

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const likedUsersIds = user.likedUsers.map(u => u._id.toString());
//     const likedByIds = user.likedBy.map(u => u._id.toString());

//     // 1. Mutual Matches (در هر دو لیست حضور دارند)
//     const mutualMatches = user.likedUsers.filter(u => 
//       likedByIds.includes(u._id.toString())
//     );

//     // 2. Incoming Likes (در لیست likedBy هستند ولی من لایکشان نکردم)
//     const incomingLikes = user.likedBy.filter(u => 
//       !likedUsersIds.includes(u._id.toString())
//     );

//     // 3. Sent Likes (من لایک کردم ولی آن‌ها هنوز لایک نکردند)
//     const sentLikes = user.likedUsers.filter(u => 
//       !likedByIds.includes(u._id.toString())
//     );

//     res.status(200).json({
//       mutualMatches,
//       incomingLikes,
//       sentLikes
//     });
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };


export const getUserLocation = async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select("location");
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
};

// export const getUserDetails = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const currentUserId = req.user.userId;

//     const targetUser = await User.findById(userId).select("-password");
//     if (!targetUser) return res.status(404).json({ message: "User not found" });

//     // Calculate match score again for consistency
//     const me = await User.findById(currentUserId);
    
//     // محاسبه دقیق امتیاز و DNA
//     const score = calculateCompatibility(me, targetUser);
//     const dna = calculateUserDNA(targetUser);
    
//     res.status(200).json({
//       ...targetUser.toObject(),
//       matchScore: score,
//       dna: dna // دیتای DNA برای پروفایل تکی
//     });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" ,err});
//   }
// };






export const getExploreMatches = async (req, res) => {
  try {
    const { country, category, page = 1, limit = 20 } = req.query;
    const currentUserId = req.user.userId;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const me = await User.findById(currentUserId);
    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";
    const userThreshold = getUserVisibilityThreshold(userPlan);

    let query = {
      _id: { $ne: currentUserId },
      "location.country": { $regex: new RegExp(`^${country}$`, "i") }
    };

    if (me.lookingFor) {
      query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
    }

    if (category && category !== 'undefined') {
      
      if (category === 'nearby') {
         const myCity = me.location?.city?.trim();
         if (myCity) query["location.city"] = { $regex: new RegExp(`^${myCity}$`, "i") };
      }

      const candidates = await User.find(query)
        .select("name avatar bio interests location birthday questionsbycategoriesResults subscription gender createdAt isVerified")
        .lean();

      const processedUsers = candidates.map(user => ({
        ...user,
        matchScore: calculateCompatibility(me, user),
        dna: calculateUserDNA(user)
      }));

      let filteredList = [];
      switch (category) {
        case 'soulmates':
          filteredList = processedUsers.filter(u => u.matchScore >= 80).sort((a, b) => b.matchScore - a.matchScore);
          break;
        case 'nearby':
          filteredList = processedUsers.sort((a, b) => b.matchScore - a.matchScore);
          break;
        case 'interests':
          filteredList = processedUsers.filter(u => u.interests.some(i => me.interests.includes(i))).sort((a, b) => b.matchScore - a.matchScore);
          break;
        case 'new':
          filteredList = processedUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          break;
        case 'country':
        default:
          filteredList = processedUsers.sort((a, b) => b.matchScore - a.matchScore);
          break;
      }

      const totalUsers = filteredList.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      
      const paginatedUsers = filteredList.slice(startIndex, startIndex + limitNum);

      return res.status(200).json({
        userPlan: userPlan,
        mode: "category", 
        users: paginatedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers }
      });
    }

    else {
      const allMatches = await User.find(query).limit(500).lean(); 
      
      let processedUsers = allMatches.map(user => ({
        ...user,
        matchScore: calculateCompatibility(me, user)
      }));

      processedUsers = processedUsers.filter(u => u.matchScore <= userThreshold);

      const highScores = processedUsers.filter(u => u.matchScore >= 80);
      const randomSoulmates = shuffleArray([...highScores]).slice(0, 10);

      const recentUsers = [...processedUsers]
        .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 100);
      const randomFreshFaces = shuffleArray(recentUsers).slice(0, 10);

      const cityUsers = processedUsers.filter(u => 
        u.location?.city?.toLowerCase() === me.location?.city?.toLowerCase()
      );
      const randomCityMatches = shuffleArray([...cityUsers]).slice(0, 10);

      const interestUsers = processedUsers.filter(u => u.interests.some(i => me.interests.includes(i)));
      const randomInterestMatches = shuffleArray([...interestUsers]).slice(0, 10);

      const topCountryUsers = [...processedUsers]
         .sort((a,b) => b.matchScore - a.matchScore)
         .slice(0, 100);
      const randomCountryMatches = shuffleArray(topCountryUsers).slice(0, 10);

      const sections = {
        soulmates: randomSoulmates,
        freshFaces: randomFreshFaces,
        cityMatches: randomCityMatches,
        interestMatches: randomInterestMatches,
        countryMatches: randomCountryMatches
      };

      return res.status(200).json({
        userPlan: userPlan,
        mode: "overview",
        sections: sections 
      });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};



export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const me = await User.findById(currentUserId);
    
    const score = calculateCompatibility(me, targetUser);
    const dna = calculateUserDNA(targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna 
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" ,err});
  }
};