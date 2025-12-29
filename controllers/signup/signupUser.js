import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import jwt from "jsonwebtoken";

export const signupUser = async (req, res) => {
  let { name, email, password, gender, lookingFor } = req.body;

  email = email.toLowerCase();
  name = name.toLowerCase();

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      gender,
      lookingFor,
    });

    await newUser.save();

    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role  },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("unlock-me-token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser._id,
        name: newUser.name,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
