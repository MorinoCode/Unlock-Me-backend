import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import jwt from "jsonwebtoken";
import { validatePassword } from "../../utils/validators.js";

const FORBIDDEN_USERNAMES = ["admin", "support", "root", "unlockme", "moderator"];

export const signupUser = async (req, res) => {
  try {
    let { name, username, email, password, gender, lookingFor } = req.body;

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ message: passwordValidation.message });
    }

    email = email.toLowerCase();
    username = username.toLowerCase();

    if (username && FORBIDDEN_USERNAMES.includes(username)) {
      return res.status(400).json({ message: "This username is not allowed (Reserved word)." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

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

    try {
      await newUser.save();
    } catch (saveError) {
      if (saveError.code === 11000) {
        if (saveError.keyPattern && saveError.keyPattern.email) {
          return res.status(400).json({ message: "Email already exists" });
        }
        if (saveError.keyPattern && saveError.keyPattern.username) {
          return res.status(400).json({ message: "Username already exists" });
        }
        return res.status(400).json({ message: "Account already exists with these credentials." });
      }
      throw saveError; 
    }

    const accessToken = jwt.sign(
      { userId: newUser._id, role: newUser.role, username: newUser.username, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: "15m" } 
    );
    
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const refreshToken = jwt.sign(
      { userId: newUser._id, type: 'refresh' },
      refreshSecret,
      { expiresIn: "7d" }
    );
    
    await User.findByIdAndUpdate(newUser._id, { 
      refreshToken: refreshToken 
    });

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

    const { dispatchExploreSync } = await import("../../utils/workerDispatcher.js");
    dispatchExploreSync(newUser._id, null); 
    
    res.status(201).json({
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: {
        id: newUser._id,
        name: newUser.name,
        username: newUser.username
      },
    });

  } catch (err) {
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
