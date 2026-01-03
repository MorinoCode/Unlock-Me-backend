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
    
    // 1. دریافت کاربر به همراه لیست مچ‌های آماده‌اش
    const me = await User.findById(currentUserId)
        .populate("potentialMatches.user", "name avatar bio interests location birthday subscription gender createdAt isVerified dna") // اینجا Populate می‌کنیم
        .select("potentialMatches subscription lookingFor location interests");

    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";
    const visibilityThreshold = getVisibilityThreshold(userPlan);
    const soulmatePerms = getSoulmatePermissions(userPlan);
    const isPremium = (userPlan === 'premium' || userPlan === 'platinum');

    // 2. استخراج لیست خام از دیتابیس (بدون محاسبه!)
    // فقط آنهایی که هنوز وجود دارند (ممکن است یوزر حذف شده باشد پس چک میکنیم user null نباشد)
    let allPreComputedMatches = me.potentialMatches
        .filter(m => m.user) 
        .map(m => ({
            ...m.user.toObject(),
            matchScore: m.matchScore // امتیاز از قبل حساب شده
        }));

    // اگر لیست خالی بود (کاربر تازه عضو شده و ورکر هنوز اجرا نشده)
    // یک فال‌بک سریع (Fallback) می‌گذاریم
    if (allPreComputedMatches.length === 0) {
        // اینجا یک کوئری ساده "آخرین کاربران" می‌زنیم که خالی نباشد
        const fallbackUsers = await User.find({
             _id: { $ne: currentUserId },
             "location.country": me.location.country 
        }).limit(20).lean();
        // یک اسکور فیک برایشان میگذاریم موقتا
        allPreComputedMatches = fallbackUsers.map(u => ({ ...u, matchScore: 70 }));
    }

    // 3. جداسازی استخرها (دقیقاً مثل قبل، ولی روی دیتای آماده)
    
    // الف) Soulmates (بالای 80)
    const soulmatePool = allPreComputedMatches.filter(u => u.matchScore >= 80)
                                              .sort((a, b) => b.matchScore - a.matchScore);

    // ب) General Pool
    let generalPool;
    if (isPremium) {
        generalPool = allPreComputedMatches;
    } else {
        generalPool = allPreComputedMatches.filter(u => u.matchScore < visibilityThreshold);
    }

    // ---------------------------------------------------------
    // MODE 1: Category Page (View All)
    // ---------------------------------------------------------
    if (category && category !== 'undefined') {
        let finalUsers = [];

        if (category === 'soulmates') {
            if (soulmatePerms.isLocked) return res.status(403).json({ message: "Upgrade required." });
            finalUsers = soulmatePerms.limit === Infinity ? soulmatePool : soulmatePool.slice(0, soulmatePerms.limit);
        } else if (category === 'new') {
             // برای Newest شاید بهتر باشد یک کوئری زنده سبک بزنیم
             // اما فعلا از همین جنرال پول سورت میکنیم
             finalUsers = [...generalPool].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
             // Nearby, Interests, ...
             // اینجا دیگر فیلترها را روی آرایه generalPool انجام میدهیم (چون تعداد کمه - ۱۰۰ تا - سریعه)
             finalUsers = [...generalPool];
             if (category === 'nearby') {
                 finalUsers = finalUsers.filter(u => u.location?.city === me.location?.city);
             }
             finalUsers.sort((a,b) => b.matchScore - a.matchScore);
        }

        // Pagination (Simple array slicing)
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedUsers = finalUsers.slice(startIndex, startIndex + parseInt(limit));

        return res.status(200).json({
            userPlan, mode: "category", users: paginatedUsers,
            pagination: { currentPage: page, totalPages: Math.ceil(finalUsers.length / limit), totalUsers: finalUsers.length }
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
            freshFaces: shuffleArray([...generalPool]).slice(0, 10), // ساده شده
            cityMatches: shuffleArray(generalPool.filter(u => u.location?.city === me.location?.city)).slice(0, 10),
            interestMatches: shuffleArray(generalPool.filter(u => u.interests.some(i => me.interests.includes(i)))).slice(0, 10),
            countryMatches: shuffleArray([...generalPool]).slice(0, 10)
        };

        return res.status(200).json({ userPlan, mode: "overview", sections });
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