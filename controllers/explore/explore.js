import User from "../../models/User.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error("Error fetching user location:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getExploreMatches = async (req, res) => {
  const { country } = req.query;
  try {
    const users = await User.find({ 
      _id: { $ne: req.user.userId },
      "location.country": country 
    }).select("name avatar bio interests location");

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" , err});
  }
};