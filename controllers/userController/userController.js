import User from "../../models/User.js";

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("name avatar"); 
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};