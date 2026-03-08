import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const signinUser = async (req, res) => {
  let { email, password } = req.body;

  try {
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });
    if (!user.password) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, location: user.location, username: user.username, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: "15m" } 
    );
    
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const refreshToken = jwt.sign(
      { userId: user._id, type: 'refresh' },
      refreshSecret,
      { expiresIn: "7d" }
    );
    
    await User.findByIdAndUpdate(user._id, { refreshToken });

    res.cookie("unlock-me-token", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000, 
    });
    
    res.cookie("unlock-me-refresh-token", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
