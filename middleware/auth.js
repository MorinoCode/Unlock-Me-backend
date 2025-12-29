import jwt, { decode } from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  const token = req.cookies["unlock-me-token"];

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId).select("-password");
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    
    req.user.userId = user._id.toString(); 

    next();
  } catch (err) {
    return res.status(401).json({ message: "Token is not valid", err });
  }
};

export const optionalProtect = async (req, res, next) => {
  const token = req.cookies["unlock-me-token"];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select("-password");
    } catch (error) {
      console.log(error);
      req.user = null;
    }
  }
  next();
};
