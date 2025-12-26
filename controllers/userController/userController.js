import User from "../../models/User.js";
import bcrypt from "bcryptjs";

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "name avatar bio location phone detailedAddress gallery gender lookingFor questionsbycategoriesResults subscription birthday"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};
export const getUserInformation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "name avatar bio location gallery gender lookingFor  subscription birthday interests questionsbycategoriesResults"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};
export const updateProfileInfo = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const {
      name,
      bio,
      phone,
      country,
      city,
      gender,
      lookingFor,
      birthday,
      avatar,
    } = req.body;

    if (!name || !country || !city || !gender || !lookingFor) {
      return res
        .status(400)
        .json({ message: "فیلدهای ستاره‌دار اجباری هستند." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          name,
          bio,
          phone,
          location: { country, city },
          gender,
          lookingFor,
          birthday,
          avatar,
        },
      },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId || req.user.id;

    const user = await User.findById(userId);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Current password incorrect" });

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateGallery = async (req, res) => {
  try {
    const { images } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!Array.isArray(images) || images.length > 6) {
      return res
        .status(400)
        .json({ message: "Invalid images or max limit (6) exceeded" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { gallery: images } },
      { new: true }
    );
    res.status(200).json(user.gallery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateCategoryAnswers = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { categoryName, answers } = req.body;

    const user = await User.findById(userId);

    user.questionsbycategoriesResults.categories.set(categoryName, answers);

    await user.save();
    res.status(200).json(user.questionsbycategoriesResults);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
