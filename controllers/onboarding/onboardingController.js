import User from "../../models/User.js";
import InitialQuizzes from "../../models/initialQuizzes.js";

// ---------- Birthday ----------
export const saveBirthday = async (req, res) => {
  try {
    const { day, month, year } = req.body.birthday || {};
    if (!day || !month || !year)
      return res.status(400).json({ message: "Birthday is required" });

    const birthday = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    await User.findByIdAndUpdate(req.user.userId, { birthday });

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

export const getUserInterestCategories = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("interests");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ userInterestedCategories: user.interests });
    console.log(user.interests);
  } catch (err) {
    console.error("Error fetching user interests:", err);
    res.status(500).json({ message: "Server error" });
  }
};