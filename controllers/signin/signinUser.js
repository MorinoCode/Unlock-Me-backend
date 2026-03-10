import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const signinUser = async (req, res) => {
  let { email, password } = req.body;

  try {
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email }).select("+password");
    if (!user || !user.password) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, location: user.location, username: user.username, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: "30m" } 
    );
    
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const refreshToken = jwt.sign(
      { userId: user._id, type: 'refresh' },
      refreshSecret,
      { expiresIn: "7d" }
    );
    
    await User.findByIdAndUpdate(user._id, { refreshToken });

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("unlock-me-token", accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      domain: isProduction ? ".unlock-me.app" : undefined,
      maxAge: 30 * 60 * 1000, 
    });
    
    res.cookie("unlock-me-refresh-token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      domain: isProduction ? ".unlock-me.app" : undefined,
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
