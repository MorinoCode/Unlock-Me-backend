import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  const token = req.cookies["unlock-me-token"];
  const refreshToken = req.cookies["unlock-me-refresh-token"];

  if (!token && !refreshToken) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    let decoded;
    
    // Try to verify access token first
    if (token) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'access') {
          throw new Error("Invalid token type");
        }
      } catch (tokenError) {
        // If access token expired, try refresh token
        if (tokenError.name === 'TokenExpiredError' && refreshToken) {
          try {
            const refreshDecoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
            if (refreshDecoded.type !== 'refresh') {
              throw new Error("Invalid refresh token type");
            }
            
            const user = await User.findById(refreshDecoded.userId).select("-password");
            if (!user || user.refreshToken !== refreshToken) {
              throw new Error("Invalid refresh token");
            }
            
            // ✅ Security Fix: Generate new access token
            const newAccessToken = jwt.sign(
              { userId: user._id, role: user.role, username: user.username, type: 'access' },
              process.env.JWT_SECRET,
              { expiresIn: "1h" }
            );
            
            const isProduction = process.env.NODE_ENV === "production";
            res.cookie("unlock-me-token", newAccessToken, {
              httpOnly: true,
              secure: isProduction,
              sameSite: "lax",
              domain: isProduction ? ".unlock-me.app" : undefined,
              maxAge: 60 * 60 * 1000, // 1 hour
            });
            
            decoded = { userId: user._id };
            req.user = user;
            req.user.userId = user._id.toString();
            return next();
          } catch {
            return res.status(401).json({ message: "Token expired. Please sign in again." });
          }
        } else {
          throw tokenError;
        }
      }
    } else {
      // No access token, try refresh token
      const refreshDecoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      if (refreshDecoded.type !== 'refresh') {
        throw new Error("Invalid refresh token type");
      }
      decoded = refreshDecoded;
    }
    
    const user = await User.findById(decoded.userId).select("-password");
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    req.user.userId = user._id.toString(); 

    next();
  } catch {
    // ✅ Security Fix: Don't expose error details
    return res.status(401).json({ message: "Token is not valid" });
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
