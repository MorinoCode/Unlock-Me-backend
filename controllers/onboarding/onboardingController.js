import User from "../../models/User.js";
import InitialQuizzes from "../../models/initialQuizzes.js";
import questionByCategory from "../../models/questionByCategory.js";
import { calculateUserDNA } from "../../utils/matchUtils.js";
import cloudinary from "../../config/cloudinary.js";
import { findMatchesForUser } from "../../workers/exploreMatchWorker.js";
import { mediaQueue, onboardingQueue } from "../../config/queue.js";

// ---------- Birthday ----------
export const saveBirthday = async (req, res) => {
  try {
    const { day, month, year } = req.body.birthday || {};
    if (!day || !month || !year)
      return res.status(400).json({ message: "Birthday is required" });

    // ذخیره به صورت آبجکت مطابق با مدل جدید
    await User.findByIdAndUpdate(req.user.userId, {
      birthday: { day, month, year },
    });

    res.status(200).json({ message: "Birthday saved" });
  } catch (err) {
    console.error("Save Birthday Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

// ---------- Interests ----------
export const saveInterests = async (req, res) => {
  try {
    const { interests } = req.body;
    if (!interests || !Array.isArray(interests))
      return res.status(400).json({ message: "Interests are required" });

    await User.findByIdAndUpdate(req.user.userId, { interests });

    res.status(200).json({ message: "Interests saved" });
  } catch (err) {
    console.error("Save Birthday Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

// ---------- Avatar ----------

// ... (توابع saveBirthday و saveInterests بدون تغییر)

// ---------- Avatar ----------
export const saveAvatar = async (req, res) => {
  try {
    // 1. چک کردن وجود فایل
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    // 2. ✅ چک کردن سایز فایل (محدودیت ۱۰ مگابایت برای امنیت سرور)
    // اگر فرانت کارش را درست انجام دهد، فایل اینجا زیر ۱۰۰ کیلوبایت است
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({
        message: "File is too large. Please upload an image smaller than 10MB.",
      });
    }

    // 3. تبدیل به فرمت Cloudinary
    const b64 = Buffer.from(req.file.buffer).toString("base64");
    let dataURI = "data:" + req.file.mimetype + ";base64," + b64;

    // 4. OFFLOAD TO BullMQ (NEW: Enterprise Hardening)
    await mediaQueue.add("UPLOAD_AVATAR", {
      type: "UPLOAD_AVATAR",
      userId: req.user.userId.toString(),
      data: { avatarBase64: dataURI }
    });

    res.status(202).json({
      message: "Avatar upload started in background.",
      status: "processing"
    });
  } catch (err) {
    console.error("Avatar Upload Error:", err);
    // اگر ارور از سمت کلودیناری بود (مثل فایل خیلی بزرگ)، متن آن را برگردان
    if (err.http_code === 400 && err.message) {
      return res.status(400).json({ message: "Upload failed: " + err.message });
    }
    res.status(500).json({ message: "Server error during image upload" });
  }
};

const LOG = (step, detail = "") =>
  console.log(`[interests-options] ${step} ${detail}`.trim());

export const getInterests = async (req, res) => {
  const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    LOG("1/6 START", `reqId=${reqId}`);

    const { getAppCache, setAppCache } = await import("../../utils/cacheHelper.js");
    LOG("2/6", "cacheHelper imported");

    const cached = await getAppCache("interests_options");
    if (cached) {
      LOG("2/6 CACHE_HIT", `items=${Array.isArray(cached) ? cached.length : "?"}`);
      return res.status(200).json(cached);
    }
    LOG("2/6 CACHE_MISS", "");

    LOG("3/6", "fetching from DB (InitialQuizzes)...");
    const doc = await InitialQuizzes.findOne({ name: "interests" }).lean();
    if (!doc) {
      LOG("3/6 DB", "doc not found (name=interests)");
      return res.status(404).json({ message: "Interests not found" });
    }
    LOG("3/6 DB_OK", `categories count=${Array.isArray(doc.categories) ? doc.categories.length : 0}`);

    const categories = doc.categories || [];
    LOG("4/6", "setting cache...");
    await setAppCache("interests_options", categories, 3600).catch((e) => {
      LOG("4/6 setCache_err", e?.message || String(e));
    });

    LOG("5/6", "sending 200 response");
    return res.status(200).json(categories);
  } catch (err) {
    console.error(`[interests-options] 6/6 ERROR reqId=${reqId}`, err?.message || err);
    console.error(`[interests-options] stack`, err?.stack || "no stack");
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    if (!res.headersSent) {
      res.status(500).json({ message: errorMessage });
    }
  }
};

export const QuestionsByCategory = async (req, res) => {
  try {
    const { selectedCategories } = req.body;

    if (
      !selectedCategories ||
      !Array.isArray(selectedCategories) ||
      selectedCategories.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Please provide an array of categories" });
    }

    const { getMatchesCache, setMatchesCache } = await import("../../utils/cacheHelper.js");
    const cacheKey = `questions_${selectedCategories.sort().join("_")}`;
    const cached = await getMatchesCache("global", cacheKey);
    if (cached) return res.status(200).json(cached);

    const foundQuestions = await questionByCategory.find({
      categoryLabel: { $in: selectedCategories },
    }).lean();

    if (foundQuestions.length === 0) {
      return res
        .status(404)
        .json({ message: "No questions found for these categories" });
    }

    await setMatchesCache("global", cacheKey, foundQuestions, 3600); // 1 hour
    res.status(200).json(foundQuestions);
  } catch (err) {
    console.error("Error fetching questions:", err);
    res.status(500).json({ message: "Server error while fetching questions" });
  }
};

const USER_INTERESTS_CACHE_TTL = 600; // 10 min

export const getUserInterestCategories = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { getMatchesCache, setMatchesCache } = await import("../../utils/cacheHelper.js");
    const cacheKey = "user_interests";
    const cached = await getMatchesCache(userId, cacheKey);
    if (cached) return res.status(200).json(cached);

    const user = await User.findById(userId).select("interests");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const payload = { userInterestedCategories: user.interests };
    await setMatchesCache(userId, cacheKey, payload, USER_INTERESTS_CACHE_TTL);
    res.status(200).json(payload);
  } catch (err) {
    console.error("Error fetching user interests:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const saveUserInterestCategoriesQuestinsAnswer = async (req, res) => {
  try {
    const { quizResults } = req.body;

    // اعتبارسنجی ورودی
    if (!quizResults || !Array.isArray(quizResults)) {
      return res.status(400).json({ message: "Invalid quiz data" });
    }

    console.log(`[Onboarding] Receiving quiz results for user ${req.user.userId}. Count: ${quizResults.length}`);
    if (quizResults.length > 0) {
        console.log(`[Onboarding] Sample Q0: "${quizResults[0].questionText}"`);
    }

    // گروه‌بندی جواب‌ها
    const groupedResults = {};
    const categoryNames = new Set();

    quizResults.forEach((item) => {
      const { category, ...rest } = item;
      categoryNames.add(category);
      if (!groupedResults[category]) {
        groupedResults[category] = [];
      }
      groupedResults[category].push({
        ...rest,
        answeredAt: new Date(),
      });
    });

    const updateQuery = {};
    for (const category in groupedResults) {
      updateQuery[`questionsbycategoriesResults.categories.${category}`] =
        groupedResults[category];
    }

    // 1. OFFLOAD PROCESSING TO BullMQ (NEW: Enterprise Hardening)
    await onboardingQueue.add("PROCESS_QUIZ_RESULTS", {
      type: "PROCESS_QUIZ_RESULTS",
      userId: req.user.userId.toString(),
      data: { updateQuery, categoryNames: Array.from(categoryNames) }
    });

    res.status(202).json({
      message: "Quiz processing started in background.",
      status: "processing"
    });
  } catch (err) {
    console.error("Error saving quiz results:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const saveLocation = async (req, res) => {
  try {
    const { location } = req.body;

    // ✅ Validation: بررسی وجود location object
    if (!location) {
      return res.status(400).json({ message: "Location data is required" });
    }

    // ✅ Validation: بررسی وجود country و city
    if (!location.country || !location.city) {
      return res.status(400).json({ message: "Country and City are required" });
    }

    // ✅ Validation: اگر لوکیشن ارسال شده، باید فرمت درست باشد
    // اما اگر ناقص یا [0,0] است، فقط آن را نادیده می‌گیریم (چون اختیاری است)
    // ✅ Fix: Always respect provided country/city regardless of coordinates
    let finalCoordinates = [0, 0];
    let country = (location.country || "").trim();
    let city = (location.city || "").trim();

    if (
      location &&
      location.coordinates &&
      Array.isArray(location.coordinates) &&
      location.coordinates.length === 2 &&
      (location.coordinates[0] !== 0 || location.coordinates[1] !== 0)
    ) {
        // اگر لوکیشن معتبر ارسال شده، استفاده کن
        finalCoordinates = location.coordinates;
    }
    
    // Fallback defaults only if empty
    if (!country) country = "World";
    if (!city) city = "Global";


    // به‌روزرسانی کل آبجکت لوکیشن (شامل type, coordinates, country, city)
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      {
        $set: {
          location: {
            type: "Point",
            coordinates: finalCoordinates,
            country: country,
            city: city,
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("✅ Location saved:", {
      userId: req.user.userId,
      country: updatedUser.location.country,
      city: updatedUser.location.city,
      coordinates: updatedUser.location.coordinates,
    });

    // ❌ REMOVED: Worker execution moved to Analysis Page
    // Workers will be triggered when user reaches Analysis Page

    res.status(200).json({
      message: "Location saved successfully",
      location: updatedUser.location,
    });
  } catch (err) {
    console.error("Error saving location:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const saveBio = async (req, res) => {
  try {
    const { bio } = req.body;

    if (bio && bio.length > 150) {
      return res
        .status(400)
        .json({ message: "Bio cannot exceed 150 characters" });
    }

    await User.findByIdAndUpdate(req.user.userId, { bio: bio || "" });

    res.status(200).json({ message: "Bio saved successfully" });
  } catch (err) {
    console.error("Error saving bio:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const triggerMatchCalculation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Trigger calculation synchronously to ensure it's done before user proceeds
    console.log(`[Onboarding] Triggering match calculation for user ${req.user.userId}...`);
    await findMatchesForUser(user);
    console.log(`[Onboarding] Match calculation completed for user ${req.user.userId}`);

    res.status(200).json({ message: "Match calculation triggered" });
  } catch (err) {
    console.error("Trigger match calculation error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const checkMatchStatus = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select("potentialMatches lastMatchCalculation");
    if (!user) return res.status(404).json({ message: "User not found" });

    const dbHasMatches = user.potentialMatches && user.potentialMatches.length > 0;
    
    // Also check Redis for high-speed readiness
    const { REDIS_PREFIXES } = await import("../../utils/redisMatchHelper.js");
    const redisClient = await import("../../config/redis.js").then(m => m.default);
    
    let redisHasMatches = false;
    if (redisClient && redisClient.isOpen) {
        const count = await redisClient.zCard(`${REDIS_PREFIXES.POOL}:${userId}`);
        redisHasMatches = count > 0;
    }

    // Strict Redis check as requested by user for high-speed experience
    // The button will ONLY appear if Redis has the matches ready.
    const isReady = redisHasMatches;
    
    res.status(200).json({
      isReady,
      matchCount: user.potentialMatches ? user.potentialMatches.length : 0,
      redisCount: redisHasMatches ? "Ready" : "Syncing",
      lastCalculation: user.lastMatchCalculation
    });
  } catch (err) {
    console.error("Check match status error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
