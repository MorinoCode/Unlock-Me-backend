import User from "../../models/User.js";
import { calculateCompatibility, calculateUserDNA } from "../../utils/matchUtils.js";


// export const getExploreMatches = async (req, res) => {
//   try {
//     const { country } = req.query;
//     const currentUserId = req.user.userId;

//     const me = await User.findById(currentUserId);
//     if (!me) return res.status(404).json({ message: "User not found" });

//     // 1. کوئری اولیه (گرفتن همه کاربران کشور)
//     const query = {
//       _id: { $ne: currentUserId },
//       "location.country": { $regex: new RegExp(`^${country}$`, "i") }
//     };

//     if (me.lookingFor) {
//       query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
//     }

//     const allMatches = await User.find(query)
//       .select("name avatar bio interests location birthday questionsbycategoriesResults subscription gender createdAt")
//       .lean(); // استفاده از lean برای سرعت بیشتر

//     // 2. محاسبه امتیاز و DNA برای همه
//     const processedUsers = allMatches.map(user => {
//       const matchScore = calculateCompatibility(me, user);
//       const dna = calculateUserDNA(user);
//       return { ...user, matchScore, dna };
//     });

//     // 3. فیلترینگ اصلی: جدا کردن Soulmates از بقیه
//     // قانون: بالای 80 درصد فقط در Soulmates باشند
//     const soulmatesList = processedUsers.filter(u => u.matchScore >= 80);
//     const othersList = processedUsers.filter(u => u.matchScore < 80);

//     // 4. ساختن سکشن‌ها (فقط از لیست othersList استفاده می‌کنیم)
    
//     // الف) Fresh Faces (جدیدترین‌ها - 10 نفر آخر)
//     // مرتب‌سازی بر اساس تاریخ ساخت اکانت (نزولی)
//     const freshFaces = [...othersList]
//       .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
//       .slice(0, 10);

//     // ب) Near You (هم‌شهری‌ها)
//     const cityMatches = othersList
//       .filter(u => u.location?.city?.toLowerCase() === me.location?.city?.toLowerCase())
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // ج) Common Interests (اشتراکات)
//     const interestMatches = othersList
//       .filter(u => u.interests.some(i => me.interests.includes(i)))
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // د) Across the Country (بقیه کشور)
//     const countryMatches = othersList
//       .sort((a, b) => b.matchScore - a.matchScore);

//     // ارسال پاسخ نهایی
//     const sections = {
//       soulmates: soulmatesList.sort((a, b) => b.matchScore - a.matchScore), // VIP Section
//       freshFaces: freshFaces,
//       cityMatches: cityMatches,
//       interestMatches: interestMatches,
//       countryMatches: countryMatches
//     };

//     res.status(200).json(sections);
//   } catch (err) {
//     console.error("Explore Error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };





export const getExploreMatches = async (req, res) => {
  try {
    const { country } = req.query;
    const currentUserId = req.user.userId;

    // 1. دریافت اطلاعات کاربر فعلی (من)
    const me = await User.findById(currentUserId);
    if (!me) return res.status(404).json({ message: "User not found" });

    // 2. کوئری برای پیدا کردن بقیه کاربران در همین کشور
    const query = {
      _id: { $ne: currentUserId },
      "location.country": { $regex: new RegExp(`^${country}$`, "i") }
    };

    if (me.lookingFor) {
      query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
    }

    // دریافت کاربران (lean برای سرعت بیشتر)
    const allMatches = await User.find(query)
      .select("name avatar bio interests location birthday questionsbycategoriesResults subscription gender createdAt")
      .lean();

    // 3. محاسبه امتیاز و DNA برای همه
    const processedUsers = allMatches.map(user => {
      const matchScore = calculateCompatibility(me, user);
      const dna = calculateUserDNA(user);
      return { ...user, matchScore, dna };
    });

    // 4. دسته‌بندی لیست‌ها

    // الف) Soulmates (فقط بالای 80 درصد)
    const soulmatesList = processedUsers
      .filter(u => u.matchScore >= 80)
      .sort((a, b) => b.matchScore - a.matchScore);

    const othersList = processedUsers.filter(u => u.matchScore < 80);

    // ب) Fresh Faces (۱۰ نفر جدیدتر از لیست others)
    const freshFaces = [...othersList]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    // ج) Near You (اصلاح شده: همه همشهری‌ها را نشان بده، حتی اگر امتیاز بالا دارند)
    const myCityNorm = me.location?.city?.toLowerCase().trim();
    
    const cityMatches = processedUsers // ⚠️ از processedUsers استفاده کردیم نه othersList
      .filter(u => u.location?.city?.toLowerCase().trim() === myCityNorm)
      .sort((a, b) => b.matchScore - a.matchScore);

    // د) Common Interests
    const interestMatches = othersList
      .filter(u => u.interests.some(i => me.interests.includes(i)))
      .sort((a, b) => b.matchScore - a.matchScore);

    // ه) Across the Country
    const countryMatches = othersList
      .sort((a, b) => b.matchScore - a.matchScore);

    // 5. ارسال پاسخ نهایی با فرمت جدید
    res.status(200).json({
      // اگر کاربر پلن نداشت، دیفالت free بگذار
      userPlan: me.subscription?.plan || "free", 
      sections: {
        soulmates: soulmatesList,
        freshFaces: freshFaces,
        cityMatches: cityMatches,
        interestMatches: interestMatches,
        countryMatches: countryMatches
      }
    });

  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// توابع دیگر (بدون تغییر، اگر در فایل هستند بمانند)
export const getUserLocation = async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select("location");
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
};



export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    // Calculate match score again for consistency
    const me = await User.findById(currentUserId);
    
    // محاسبه دقیق امتیاز و DNA
    const score = calculateCompatibility(me, targetUser);
    const dna = calculateUserDNA(targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna // دیتای DNA برای پروفایل تکی
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" ,err});
  }
};