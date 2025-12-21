import User from "../../models/User.js";
import InitialQuizzes from "../../models/initialQuizzes.js";
import questionByCategory from "../../models/questionByCategory.js";

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

    if (!quizResults || !Array.isArray(quizResults)) {
      return res.status(400).json({ message: "Invalid quiz data" });
    }

    
    const groupedResults = {};
    quizResults.forEach(item => {
      const { category, ...rest } = item;
      if (!groupedResults[category]) {
        groupedResults[category] = [];
      }
      groupedResults[category].push({
        ...rest,
        answeredAt: new Date()
      });
    });

    
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { 
        $set: { "questionsbycategoriesResults.categories": groupedResults } 
      },
      { new: true }
    );

    res.status(200).json({ 
      message: "Quiz results saved successfully",
      categoriesSaved: Object.keys(groupedResults),
      updatedUser
    });
  } catch (err) {
    console.error("Error saving quiz results:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const saveLocation = async (req, res) => {
  try {
    const { country, city } = req.body;
    if (!country || !city) {
      return res.status(400).json({ message: "Country and City are required" });
    }

    await User.findByIdAndUpdate(req.user.userId, {
      location: { country, city }
    });

    res.status(200).json({ message: "Location saved successfully" });
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

