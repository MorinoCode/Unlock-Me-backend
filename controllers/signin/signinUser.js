import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


export const signinUser = async (req, res) => {
  let { email, password } = req.body;

  try {
    // 1. نرمال‌سازی ایمیل (کوچک کردن + حذف فاصله‌های اضافی احتمالی)
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });
    if (!user.password) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // ✅ Security Fix: Shorter access token + refresh token
    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, location: user.location, username: user.username, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    const refreshToken = jwt.sign(
      { userId: user._id, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    // Store refresh token
    await User.findByIdAndUpdate(user._id, { refreshToken });

    // 2. تشخیص محیط (لوکال یا پروداکشن)
    const isProduction = process.env.NODE_ENV === "production";

    // 3. تنظیم کوکی (اصلاح شده برای آیفون و ساب‌دامین)
    res.cookie("unlock-me-token", accessToken, {
      httpOnly: true,
      secure: isProduction, 
      sameSite: "lax", 
      domain: isProduction ? ".unlock-me.app" : undefined, 
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    
    res.cookie("unlock-me-refresh-token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      domain: isProduction ? ".unlock-me.app" : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
      },
    });
  } catch (err) {
    console.error("Signin Error:", err);
    // ✅ Security Fix: Don't expose error details
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
