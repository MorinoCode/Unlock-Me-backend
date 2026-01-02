import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


export const signinUser = async (req, res) => {
  let { email, password } = req.body;

  try {
    // 1. نرمال‌سازی ایمیل (کوچک کردن + حذف فاصله‌های اضافی احتمالی)
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role, location: user.location, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 2. تشخیص محیط (لوکال یا پروداکشن)
    const isProduction = process.env.NODE_ENV === "production";

    // 3. تنظیم کوکی (اصلاح شده برای آیفون و ساب‌دامین)
    res.cookie("unlock-me-token", token, {
      httpOnly: true,
      
      // در پروداکشن True، در لوکال False (تا روی http کار کند)
      secure: isProduction, 
      
      // بهترین گزینه برای سازگاری با موبایل وقتی دامین ست می‌کنیم
      sameSite: "lax", 
      
      // ⚠️ حیاتی‌ترین خط: اشتراک کوکی بین api.unlock-me.app و unlock-me.app
      domain: isProduction ? ".unlock-me.app" : undefined, 
      
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
