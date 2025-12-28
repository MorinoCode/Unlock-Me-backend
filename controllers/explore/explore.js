import User from "../../models/User.js";
import { 
  calculateCompatibility, 
  calculateUserDNA, 
  getUserVisibilityThreshold, 
  shuffleArray, 
  generateMatchInsights // ✅ اضافه شد
} from "../../utils/matchUtils.js";

export const getUserLocation = async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select("location");
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: "Server error" ,err});
    }
};

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

// ==========================================
// ✅ آپدیت شده: اضافه شدن Insights به جزئیات کاربر
// ==========================================
export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const me = await User.findById(currentUserId);
    
    // محاسبه امتیاز
    const score = calculateCompatibility(me, targetUser);
    
    // محاسبه DNA
    const dna = calculateUserDNA(targetUser);

    // ✅ تولید تحلیل هوشمند (Insights)
    const insights = generateMatchInsights(me, targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights // حالا فرانت می‌تواند این را هم نمایش دهد
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" ,err});
  }
};