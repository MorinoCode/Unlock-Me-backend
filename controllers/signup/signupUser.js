import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import jwt from "jsonwebtoken";
import { validatePassword } from "../../utils/validators.js";

const FORBIDDEN_USERNAMES = ["admin", "support", "root", "unlockme", "moderator"];

export const signupUser = async (req, res) => {
  try {
    let { name, username, email, password, gender, lookingFor } = req.body;

    // ✅ Security Fix: Backend validation (even though middleware validates, double-check here)
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ message: passwordValidation.message });
    }

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

    // 5. ساخت کاربر با 7 روز Platinum Trial رایگان
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + 7);

    const newUser = new User({
      name,
      username,
      email,
      password: hashedPassword,
      gender,
      lookingFor,
      subscription: {
        plan: "platinum",
        status: "active",
        isTrial: true,
        trialExpiresAt: trialExpiresAt,
        expiresAt: trialExpiresAt,
        startedAt: new Date(),
      },
    });

    await newUser.save();

    // ✅ Security Fix: Shorter token expiration + refresh token
    // Access token: 1 hour (was 7 days)
    const accessToken = jwt.sign(
      { userId: newUser._id, role: newUser.role, username: newUser.username, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    // Refresh token: 7 days
    const refreshToken = jwt.sign(
      { userId: newUser._id, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    // Store refresh token in user document (for future token refresh endpoint)
    await User.findByIdAndUpdate(newUser._id, { 
      refreshToken: refreshToken 
    });

   const isProduction = process.env.NODE_ENV === "production";

    // ✅ Security Fix: Set access token cookie (1 hour)
    res.cookie("unlock-me-token", accessToken, {
      httpOnly: true,
      secure: isProduction, 
      sameSite: "lax", 
      domain: isProduction ? ".unlock-me.app" : undefined, 
      maxAge: 60 * 60 * 1000, // 1 hour
    });
    
    // ✅ Security Fix: Set refresh token cookie (7 days)
    res.cookie("unlock-me-refresh-token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      domain: isProduction ? ".unlock-me.app" : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // ✅ Trigger Redis Sync (Add new user to Explore)
    const { dispatchExploreSync } = await import("../../utils/workerDispatcher.js");
    dispatchExploreSync(newUser._id, null); // New user has no "old data"
    
    // ❌ REMOVED: Worker execution moved to Analysis Page
    // Workers will run AFTER onboarding when user info is complete
    
    res.status(201).json({
      message: "User registered successfully",
      token: accessToken, // Assuming 'token' refers to accessToken
      user: {
        id: newUser._id,
        name: newUser.name,
        username: newUser.username
      },
    });

  } catch (err) {
    console.error("Signup Error:", err);
    // ✅ Security Fix: Don't expose error details in production
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
