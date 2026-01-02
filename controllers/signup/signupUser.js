import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import jwt from "jsonwebtoken";

const FORBIDDEN_USERNAMES = ["admin", "support", "root", "unlockme", "moderator"];

export const signupUser = async (req, res) => {
  try {
    let { name, username, email, password, gender, lookingFor } = req.body;

    // 1. نرمال‌سازی داده‌ها
    email = email.toLowerCase();
    username = username.toLowerCase();
    // نکته: name را دستکاری نمی‌کنیم تا حروف بزرگ کاربر حفظ شود

    // 2. چک کردن کلمات ممنوعه
    if (username && FORBIDDEN_USERNAMES.includes(username)) {
      return res.status(400).json({ message: "This username is not allowed (Reserved word)." });
    }

    // 3. چک کردن تکراری بودن (می‌توانیم با Promise.all سرعت را بالا ببریم)
    // اینجوری هر دو چک همزمان انجام می‌شوند نه پشت سر هم
    const [existingEmail, existingUsername] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ username })
    ]);

    if (existingEmail) {
      return res.status(400).json({ message: "Email already exists" });
    }
    if (existingUsername) {
      return res.status(400).json({ message: "Username already exists" });
    }

    // 4. هش کردن پسورد
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 5. ساخت کاربر
    const newUser = new User({
      name, // حروف بزرگ حفظ می‌شود
      username,
      email,
      password: hashedPassword,
      gender,
      lookingFor,
    });

    await newUser.save();

    // 6. ساخت توکن
    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role, username: newUser.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

   const isProduction = process.env.NODE_ENV === "production";

    res.cookie("unlock-me-token", token, {
      httpOnly: true,
      
      // در پروداکشن حتما True
      secure: isProduction, 
      
      // تغییر مهم: وقتی دامین ست می‌کنیم، Lax بهترین گزینه برای آیفون است
      sameSite: "lax", 
      
      // تغییر حیاتی: این خط باعث می‌شود کوکی بین api و سایت اصلی شیر شود
      // اگر این را نگذاری، آیفون کوکی را ذخیره نمی‌کند
      domain: isProduction ? ".unlock-me.app" : undefined, 
      
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        username: newUser.username
      },
    });

  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};