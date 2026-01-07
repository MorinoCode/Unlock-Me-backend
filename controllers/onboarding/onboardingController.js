import User from "../../models/User.js";
import InitialQuizzes from "../../models/initialQuizzes.js";
import questionByCategory from "../../models/questionByCategory.js";
import { calculateUserDNA } from "../../utils/matchUtils.js";

// ---------- Birthday ----------
export const saveBirthday = async (req, res) => {
  try {
    const { day, month, year } = req.body.birthday || {};
    if (!day || !month || !year)
      return res.status(400).json({ message: "Birthday is required" });

    // ذخیره به صورت آبجکت مطابق با مدل جدید
    await User.findByIdAndUpdate(req.user.userId, { 
      birthday: { day, month, year } 
    });

    res.status(200).json({ message: "Birthday saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
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
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------- Avatar ----------
export const saveAvatar = async (req, res) => {
  try {
    let avatarUrl = null;

    if (req.file) {
      avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
        "base64"
      )}`;
    } else {
      // Default avatar
      avatarUrl = "https://example.com/default-avatar.png";
    }

    await User.findByIdAndUpdate(req.user.userId, { avatar: avatarUrl });

    res.status(200).json({ message: "Avatar saved", avatarUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getInterests = async (req, res) => {
  try {
    const doc = await InitialQuizzes.findOne({ name: "interests" });
    if (!doc) return res.status(404).json({ message: "Interests not found" });

    res.status(200).json(doc.categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const QuestionsByCategory = async (req, res) => {
  try {
    const { selectedCategories } = req.body; 

    if (!selectedCategories || !Array.isArray(selectedCategories) || selectedCategories.length === 0) {
      return res.status(400).json({ message: "Please provide an array of categories" });
    }

    const foundQuestions = await questionByCategory.find({
      categoryLabel: { $in: selectedCategories }
    });

    if (foundQuestions.length === 0) {
      return res.status(404).json({ message: "No questions found for these categories" });
    }

    res.status(200).json(foundQuestions);
  } catch (err) {
    console.error("Error fetching questions:", err);
    res.status(500).json({ message: "Server error while fetching questions" });
  }
};

export const getUserInterestCategories = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("interests");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ userInterestedCategories: user.interests });
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

    quizResults.forEach(item => {
      const { category, ...rest } = item;
      categoryNames.add(category); 
      if (!groupedResults[category]) {
        groupedResults[category] = [];
      }
      groupedResults[category].push({
        ...rest,
        answeredAt: new Date()
      });
    });

    const updateQuery = {};
    for (const category in groupedResults) {
      updateQuery[`questionsbycategoriesResults.categories.${category}`] = groupedResults[category];
    }

    // 1. آپدیت جواب‌ها در دیتابیس
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { 
        $set: updateQuery,
        $addToSet: { interests: { $each: Array.from(categoryNames) } }
      },
      { new: true } // گرفتن نسخه آپدیت شده یوزر
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    // ✅ 2. محاسبه مجدد DNA (با فلگ true برای نادیده گرفتن کش)
    // الان که "Detail-oriented" را به مپینگ اضافه کردیم، این تابع درست کار می‌کند
    const newDNA = calculateUserDNA(updatedUser, true);
    
    // ✅ 3. ذخیره DNA در دیتابیس
    updatedUser.dna = newDNA;
    await updatedUser.save();

    console.log("🧬 DNA Updated:", newDNA); // برای اطمینان در کنسول ببینید

    res.status(200).json({ 
      message: "Category and Interests updated successfully",
      categoriesSaved: Array.from(categoryNames),
      updatedUser,
      dna: newDNA // ارسال به فرانت
    });
  } catch (err) {
    console.error("Error saving quiz results:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const saveLocation = async (req, res) => {
  try {
    const { location } = req.body;

    // اعتبارسنجی پایه برای وجود شهر و کشور در بدنه ارسالی
    if (!location || !location.country || !location.city) {
      return res.status(400).json({ message: "Country and City are required" });
    }

    // به‌روزرسانی کل آبجکت لوکیشن (شامل type, coordinates, country, city)
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: { location: location } },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ 
      message: "Location saved successfully", 
      location: updatedUser.location 
    });
  } catch (err) {
    console.error("Error saving location:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const saveBio = async (req, res) => {
  try {
    const { bio } = req.body;
    
    if (bio && bio.length > 150) {
      return res.status(400).json({ message: "Bio cannot exceed 150 characters" });
    }

    await User.findByIdAndUpdate(req.user.userId, { bio: bio || "" });

    res.status(200).json({ message: "Bio saved successfully" });
  } catch (err) {
    console.error("Error saving bio:", err);
    res.status(500).json({ message: "Server error" });
  }
};

