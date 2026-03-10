import jwt from "jsonwebtoken";
import User from "../../models/User.js";

export const refreshToken = async (req, res) => {
  try {
    let token = req.cookies["unlock-me-refresh-token"] || req.headers["x-refresh-token"] || req.body.refreshToken;
    
    if (!token) {
      return res.status(401).json({ message: "Refresh token not found" });
    }
    
    try {
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const decoded = jwt.verify(token, refreshSecret);
      
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ message: "Invalid token type" });
      }
      
      const user = await User.findById(decoded.userId).select("-password");
      
      if (!user || user.refreshToken !== token) {
        return res.status(401).json({ message: "Invalid refresh token" });
      }
      
      const accessToken = jwt.sign(
        { userId: user._id, role: user.role, username: user.username, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: "30m" } 
      );
      
      const isProduction = process.env.NODE_ENV === "production";
      
      res.cookie("unlock-me-token", accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        domain: isProduction ? ".unlock-me.app" : undefined,
        maxAge: 30 * 60 * 1000, 
      });
      
      res.set("x-access-token", accessToken);
      
      res.status(200).json({ 
        message: "Token refreshed successfully",
        accessToken,
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
