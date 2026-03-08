import jwt from "jsonwebtoken";
import User from "../../models/User.js";

export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies["unlock-me-refresh-token"];
    
    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token not found" });
    }
    
    try {
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const decoded = jwt.verify(refreshToken, refreshSecret);
      
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ message: "Invalid token type" });
      }
      
      const user = await User.findById(decoded.userId).select("-password");
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      if (user.refreshToken !== refreshToken) {
        return res.status(401).json({ message: "Invalid refresh token" });
      }
      
      const accessToken = jwt.sign(
        { userId: user._id, role: user.role, username: user.username, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: "15m" } 
      );
      
      res.cookie("unlock-me-token", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 15 * 60 * 1000, 
      });
      
      res.status(200).json({ 
        message: "Token refreshed successfully",
        user: {
          id: user._id,
          name: user.name,
        }
      });
      
    } catch {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }
    
  } catch (error) {
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
