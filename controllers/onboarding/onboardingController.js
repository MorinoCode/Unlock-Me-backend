import User from "../../models/User.js";
import InitialQuizzes from "../../models/initialQuizzes.js";
import questionByCategory from "../../models/questionByCategory.js";
import { calculateUserDNA } from "../../utils/matchUtils.js";
import cloudinary from "../../config/cloudinary.js";

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

    // 4. آپلود
    const uploadResponse = await cloudinary.uploader.upload(dataURI, {
      folder: "user_avatars",
      format: "webp",
      transformation: [
        { width: 500, height: 500, crop: "fill", gravity: "face" },
        { quality: "auto" },
      ],
    });

    await User.findByIdAndUpdate(req.user.userId, {
      avatar: uploadResponse.secure_url,
    });

    res.status(200).json({
      message: "Avatar saved successfully",
      avatarUrl: uploadResponse.secure_url,
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

export const getInterests = async (req, res) => {
  try {
    const { getAppCache, setAppCache } = await import("../../utils/cacheHelper.js");
    const cached = await getAppCache("interests_options");
    if (cached) return res.status(200).json(cached);

    const doc = await InitialQuizzes.findOne({ name: "interests" });
    if (!doc) return res.status(404).json({ message: "Interests not found" });

    await setAppCache("interests_options", doc.categories, 3600); // 1 hour
    res.status(200).json(doc.categories);
  } catch (err) {
    console.error("Save Birthday Error:", err);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : err.message;
    res.status(500).json({ message: errorMessage });
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

    // 1. آپدیت جواب‌ها در دیتابیس
    // استفاده از { new: true } برای گرفتن دیتای جدید جهت محاسبه DNA
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      {
        $set: updateQuery,
        $addToSet: { interests: { $each: Array.from(categoryNames) } },
      },
      { new: true }
    );

    if (!updatedUser)
      return res.status(404).json({ message: "User not found" });

    // 2. محاسبه مجدد DNA
    // (مطمئن شو که calculateUserDNA ایمپورت شده باشد)
    const newDNA = calculateUserDNA(updatedUser, true);

    // 3. ذخیره DNA در دیتابیس با استفاده از update (نه save)
    // ✅ FIX: استفاده از updateOne یا findByIdAndUpdate برای جلوگیری از چک کردن سایر فیلدها مثل Gender
    await User.findByIdAndUpdate(req.user.userId, { dna: newDNA });

    console.log("🧬 DNA Updated:", newDNA);

    const { invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
    await invalidateMatchesCache(req.user.userId, "user_interests").catch(() => {});

    res.status(200).json({
      message: "Category and Interests updated successfully",
      categoriesSaved: Array.from(categoryNames),
      updatedUser, // توجه: این آبجکت DNA جدید را ندارد چون در مرحله قبل فچ شده، اما در دیتابیس ذخیره شده
      dna: newDNA, // DNA جدید را جداگانه می‌فرستیم که فرانت آپدیت کند
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

    // ✅ Validation: بررسی وجود coordinates معتبر
    if (
      !location.coordinates ||
      !Array.isArray(location.coordinates) ||
      location.coordinates.length !== 2 ||
      location.coordinates[0] === 0 ||
      location.coordinates[1] === 0
    ) {
      return res.status(400).json({
        message:
          "Valid location coordinates are required. Please allow location access.",
      });
    }

    // ✅ Validation: بررسی معتبر بودن coordinates (نباید [0,0] باشد)
    const [longitude, latitude] = location.coordinates;
    if (longitude === 0 && latitude === 0) {
      return res.status(400).json({
        message: "Invalid location coordinates. Please allow location access.",
      });
    }

    // ✅ Validation: بررسی محدوده معتبر برای coordinates
    if (
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return res.status(400).json({
        message: "Invalid location coordinates range.",
      });
    }

    // به‌روزرسانی کل آبجکت لوکیشن (شامل type, coordinates, country, city)
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      {
        $set: {
          location: {
            type: location.type || "Point",
            coordinates: location.coordinates,
            country: location.country.trim(),
            city: location.city.trim(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Log برای اطمینان از save شدن
    console.log("✅ Location saved:", {
      userId: req.user.userId,
      country: updatedUser.location.country,
      city: updatedUser.location.city,
      coordinates: updatedUser.location.coordinates,
    });

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
