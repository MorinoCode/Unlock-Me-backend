/**
 * ✅ Security Fix: Token Refresh Endpoint
 * Allows users to refresh their access token using refresh token
 */

import jwt from "jsonwebtoken";
import User from "../../models/User.js";

export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies["unlock-me-refresh-token"];
    
    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token not found" });
    }
    
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ message: "Invalid token type" });
      }
      
      const user = await User.findById(decoded.userId).select("-password");
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Check if refresh token matches stored token
      if (user.refreshToken !== refreshToken) {
        return res.status(401).json({ message: "Invalid refresh token" });
      }
      
      // Generate new access token
      const accessToken = jwt.sign(
        { userId: user._id, role: user.role, username: user.username, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      
      const isProduction = process.env.NODE_ENV === "production";
      
      res.cookie("unlock-me-token", accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        domain: isProduction ? ".unlock-me.app" : undefined,
        maxAge: 60 * 60 * 1000, // 1 hour
      });
      
      res.status(200).json({ 
        message: "Token refreshed successfully",
        user: {
          id: user._id,
          name: user.name,
        }
      });
      
    } catch (tokenError) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }
    
  } catch (error) {
    console.error("Refresh Token Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
