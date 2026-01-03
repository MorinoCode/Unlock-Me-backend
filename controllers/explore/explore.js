// backend/controllers/exploreController.js

import User from "../../models/User.js";
import { 
  calculateCompatibility, 
  calculateUserDNA, 
  shuffleArray, 
  generateMatchInsights,
  getVisibilityThreshold,
  getSoulmatePermissions,
  escapeRegex
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
    const visibilityThreshold = getVisibilityThreshold(userPlan); 
    const soulmatePerms = getSoulmatePermissions(userPlan); 
    const isPremium = (userPlan === 'premium' || userPlan === 'platinum');

    // 1. ساخت کوئری دیتابیس
    let query = {
      _id: { $ne: currentUserId }
    };

    if (country) {
        query["location.country"] = { $regex: new RegExp(`^${escapeRegex(country)}$`, "i") };
    }

    if (me.lookingFor) {
      query.gender = { $regex: new RegExp(`^${escapeRegex(me.lookingFor)}$`, "i") };
    }

    if (category === 'nearby') {
        const myCity = me.location?.city?.trim();
        if (myCity) {
            query["location.city"] = { $regex: new RegExp(`^${escapeRegex(myCity)}$`, "i") };
        }
    }

    // 2. دریافت کاندیداها
    // ✅ FIX 2: Discovery Bias Fix -> استفاده از .sort({ updatedAt: -1 })
    // این باعث می‌شود کاربران فعال (که اخیراً آپدیت شده‌اند) اولویت داشته باشند
    const candidates = await User.find(query)
      .select("name avatar bio interests location birthday questionsbycategoriesResults subscription gender createdAt updatedAt isVerified dna") // dna را هم سلکت کردم
      .sort({ updatedAt: -1 }) // <--- تغییر حیاتی: جدیدترین‌های فعال اول می‌آیند
      .limit(category ? 1000 : 500)
      .lean();

    // 3. پردازش اولیه
    const processedUsers = candidates.map(user => ({
      ...user,
      matchScore: calculateCompatibility(me, user),
      dna: calculateUserDNA(user)
    }));

    // =========================================================
    // 4. منطق استخرها (Pool Logic)
    // =========================================================

    // A. استخر سول‌میت: همیشه افراد بالای ۸۰٪
    const soulmatePool = processedUsers.filter(u => u.matchScore >= 80)
                                       .sort((a, b) => b.matchScore - a.matchScore);

    // B. استخر عمومی
    let generalPool;
    if (isPremium) {
        generalPool = processedUsers; 
    } else {
        generalPool = processedUsers.filter(u => u.matchScore < visibilityThreshold);
    }

    // ---------------------------------------------------------
    // MODE 1: Category Page (View All)
    // ---------------------------------------------------------
    if (category && category !== 'undefined') {
      let finalUsers = [];

      if (category === 'soulmates') {
        if (soulmatePerms.isLocked) {
           return res.status(403).json({ message: "Upgrade required." });
        }
        finalUsers = soulmatePerms.limit === Infinity 
            ? soulmatePool 
            : soulmatePool.slice(0, soulmatePerms.limit);
      } 
      else {
        finalUsers = [...generalPool];

        switch (category) {
          case 'new':
            finalUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
          case 'interests':
            finalUsers = finalUsers.filter(u => u.interests.some(i => me.interests.includes(i)))
                                   .sort((a, b) => b.matchScore - a.matchScore);
            break;
          default:
            finalUsers.sort((a, b) => b.matchScore - a.matchScore);
        }
      }

      // Pagination
      const totalUsers = finalUsers.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedUsers = finalUsers.slice(startIndex, startIndex + limitNum);

      return res.status(200).json({
        userPlan,
        mode: "category",
        users: paginatedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers }
      });
    }

    // ---------------------------------------------------------
    // MODE 2: Overview Page
    // ---------------------------------------------------------
    else {
      let finalSoulmates = [];
      if (!soulmatePerms.isLocked) {
          finalSoulmates = soulmatePerms.limit === Infinity
              ? shuffleArray([...soulmatePool]).slice(0, 10)
              : soulmatePool.slice(0, soulmatePerms.limit);
      }

      const sections = {
        soulmates: finalSoulmates,
        
        freshFaces: shuffleArray([...generalPool]
          .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 50)).slice(0, 10),

        cityMatches: shuffleArray(generalPool.filter(u => 
          u.location?.city?.trim().toLowerCase() === me.location?.city?.trim().toLowerCase() // اینجا هم trim اضافه شد برای اطمینان
        )).slice(0, 10),

        interestMatches: shuffleArray(generalPool.filter(u => 
           u.interests.some(i => me.interests.includes(i))
        )).slice(0, 10),

        countryMatches: shuffleArray([...generalPool]
          .sort((a,b) => b.matchScore - a.matchScore)
          .slice(0, 50)).slice(0, 10)
      };

      return res.status(200).json({
        userPlan,
        mode: "overview",
        sections
      });
    }

  } catch (err) {
    console.error("Explore Error:", err);
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
    const insights = generateMatchInsights(me, targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights 
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" ,err});
  }
};