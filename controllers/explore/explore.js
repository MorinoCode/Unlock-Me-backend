// backend/controllers/exploreController.js

import User from "../../models/User.js";
import {
  calculateCompatibility,
  calculateUserDNA,
  shuffleArray,
  generateMatchInsights,
  getVisibilityThreshold,
  getSoulmatePermissions,
  escapeRegex,
} from "../../utils/matchUtils.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error", err });
  }
};

export const getExploreMatches = async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const currentUserId = req.user.userId;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // دریافت اطلاعات کاربر
    const me = await User.findById(currentUserId).select(
      "location interests lookingFor subscription potentialMatches"
    );

    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";

    // ✅ استفاده از توابع کمکی
    const visibilityThreshold = getVisibilityThreshold(userPlan);
    const soulmatePerms = getSoulmatePermissions(userPlan);
    const isPremium = userPlan === "premium" || userPlan === "platinum";

    // =========================================================
    // 🔵 MODE 1: View All - Cached Strategy (Soulmates, Interests)
    // =========================================================
    if (category === "soulmates" || category === "interests") {
      // ✅ چک کردن دسترسی برای سول‌میت
      if (category === "soulmates" && soulmatePerms.isLocked) {
        return res
          .status(403)
          .json({ message: "Upgrade required to view Soulmates." });
      }

      await me.populate({
        path: "potentialMatches.user",
        select:
          "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
      });

      let cachedUsers = me.potentialMatches
        .filter((m) => m.user)
        .map((m) => ({ ...m.user.toObject(), matchScore: m.matchScore }));

      if (category === "soulmates") {
        cachedUsers = cachedUsers.filter((u) => u.matchScore >= 80);
      } else if (category === "interests") {
        cachedUsers = cachedUsers.filter((u) =>
          u.interests.some((i) => me.interests.includes(i))
        );
      }

      cachedUsers.sort((a, b) => b.matchScore - a.matchScore);

      const totalUsers = cachedUsers.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedUsers = cachedUsers.slice(
        startIndex,
        startIndex + limitNum
      );

      return res.status(200).json({
        mode: "cached_list",
        userPlan, // ✅ ADDED: بسیار مهم برای باز شدن قفل‌ها
        users: paginatedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
      });
    }

    // =========================================================
    // 🟢 MODE 2: View All - Live DB Strategy (New, Nearby, Country)
    // =========================================================
    else if (
      category === "new" ||
      category === "nearby" ||
      category === "country"
    ) {
      let dbQuery = {
        _id: { $ne: currentUserId },
        "location.country": me.location.country,
      };

      if (me.lookingFor && me.lookingFor !== "all") {
        dbQuery.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
      }

      if (category === "nearby") {
        if (me.location?.city) {
          dbQuery["location.city"] = {
            $regex: new RegExp(`^${escapeRegex(me.location.city)}$`, "i"),
          };
        }
      }

      let sortOption = { createdAt: -1 };
      if (category === "country") sortOption = { createdAt: -1 };

      const totalUsers = await User.countDocuments(dbQuery);
      const totalPages = Math.ceil(totalUsers / limitNum);

      const candidates = await User.find(dbQuery)
        .select(
          "name avatar bio interests location birthday subscription gender createdAt isVerified dna"
        )
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      const processedUsers = candidates.map((user) => {
        const cached = me.potentialMatches?.find(
          (m) => m.user.toString() === user._id.toString()
        );
        // لاجیک هوشمند: اگر در کش صفر بود، دوباره حساب کن
        const score =
          cached && cached.matchScore > 0
            ? cached.matchScore
            : calculateCompatibility(me, user);
        return { ...user, matchScore: score, dna: calculateUserDNA(user) };
      });

      if (category !== "new") {
        processedUsers.sort((a, b) => b.matchScore - a.matchScore);
      }

      return res.status(200).json({
        mode: "live_list",
        userPlan, // ✅ ADDED: بسیار مهم برای باز شدن قفل‌ها
        users: processedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
      });
    }

    // =========================================================
    // 🟡 MODE 3: Overview / Dashboard
    // =========================================================
    else {
      await me.populate({
        path: "potentialMatches.user",
        select:
          "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
      });

      let allMatches = me.potentialMatches
        .filter((m) => m.user)
        .map((m) => {
          const userObj = m.user.toObject();
          // لاجیک هوشمند: اگر در کش صفر بود، دوباره حساب کن
          const finalScore =
            m.matchScore && m.matchScore > 0
              ? m.matchScore
              : calculateCompatibility(me, userObj);

          return { ...userObj, matchScore: finalScore };
        });

      // Fallback برای کاربران جدید
      if (allMatches.length === 0) {
        const fallbackUsers = await User.find({
          _id: { $ne: currentUserId },
          "location.country": me.location.country,
        })
          .limit(20)
          .lean();
        allMatches = fallbackUsers.map((u) => ({
          ...u,
          matchScore: calculateCompatibility(me, u),
        }));
      }

      // 1. ساخت استخر Soulmates
      const soulmatePool = allMatches
        .filter((u) => u.matchScore >= 80)
        .sort((a, b) => b.matchScore - a.matchScore);

      // 2. ساخت استخر عمومی
      let generalPool;
      if (isPremium) {
        generalPool = allMatches;
      } else {
        generalPool = allMatches.filter(
          (u) => u.matchScore < visibilityThreshold
        );
      }

      // 3. اعمال محدودیت روی Soulmates
      let finalSoulmates = [];
      if (!soulmatePerms.isLocked) {
        finalSoulmates =
          soulmatePerms.limit === Infinity
            ? shuffleArray([...soulmatePool]).slice(0, 10)
            : soulmatePool.slice(0, soulmatePerms.limit);
      }

      // 4. ساختن سکشن‌ها
      const sections = {
        soulmates: finalSoulmates,
        freshFaces: shuffleArray([...generalPool]).slice(0, 10),
        cityMatches: shuffleArray(
          generalPool.filter((u) => u.location?.city === me.location?.city)
        ).slice(0, 10),
        interestMatches: shuffleArray(
          generalPool.filter((u) =>
            u.interests.some((i) => me.interests.includes(i))
          )
        ).slice(0, 10),
        countryMatches: shuffleArray([...generalPool]).slice(0, 10),
      };

      return res.status(200).json({
        userPlan, // این قبلا بود و درست است
        mode: "overview",
        sections,
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

    const me = await User.findById(currentUserId).select(
      "potentialMatches interests location dna lookingFor"
    );

    const cachedMatch = me.potentialMatches?.find(
      (m) => m.user.toString() === targetUser._id.toString()
    );

    let score;

    // لاجیک هوشمند: هماهنگی با اکسپلور
    if (cachedMatch && cachedMatch.matchScore > 0) {
      score = cachedMatch.matchScore;
    } else {
      score = calculateCompatibility(me, targetUser);
    }

    const dna = calculateUserDNA(targetUser);
    const insights = generateMatchInsights(me, targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights,
    });
  } catch (err) {
    console.error("User Details Error:", err);
    res.status(500).json({ message: "Server error", err });
  }
};