import jwt from "jsonwebtoken";
import User from "../models/User.js";
import redisClient from "../config/redis.js";

const _lastActiveDebounce = new Map();
const ACTIVE_DEBOUNCE_MS = 5 * 60 * 1000;

function updateLastActive(userId) {
  const now = Date.now();
  const last = _lastActiveDebounce.get(userId) || 0;
  if (now - last < ACTIVE_DEBOUNCE_MS) return;
  _lastActiveDebounce.set(userId, now);
  User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).catch(() => {});
}

const getUserFromCache = async (userId) => {
  try {
    const cached = await redisClient.get(`user:session:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch { 
    // Ignore cache error 
  }
  return null;
};

const cacheUser = async (userId, userData) => {
  try {
    await redisClient.setEx(`user:session:${userId}`, 300, JSON.stringify(userData));
  } catch {
    // Ignore cache error
  }
};

export const invalidateUserCache = async (userId) => {
  try {
    await redisClient.del(`user:session:${userId}`);
  } catch {
    // Ignore cache error
  }
};

export const protect = async (req, res, next) => {
  let token = req.cookies["unlock-me-token"];
  if (!token && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  let refreshToken = req.cookies["unlock-me-refresh-token"] || req.headers["x-refresh-token"];

  if (!token && !refreshToken) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    let decoded;
    let user;

    if (token) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== "access") throw new Error("Invalid token type");
      } catch (tokenError) {
        if (tokenError.name === "TokenExpiredError" && refreshToken) {
          try {
            const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
            const refreshDecoded = jwt.verify(refreshToken, refreshSecret);
            if (refreshDecoded.type !== "refresh") throw new Error("Invalid refresh token type");

            const dbUser = await User.findById(refreshDecoded.userId).select("-password");
            if (!dbUser || dbUser.refreshToken !== refreshToken) throw new Error("Invalid refresh token");

            const newAccessToken = jwt.sign(
              { userId: dbUser._id, role: dbUser.role, username: dbUser.username, type: "access" },
              process.env.JWT_SECRET,
              { expiresIn: "30m" }
            );

            const isProduction = process.env.NODE_ENV === "production";
            res.cookie("unlock-me-token", newAccessToken, {
              httpOnly: true,
              secure: isProduction,
              sameSite: "lax",
              domain: isProduction ? ".unlock-me.app" : undefined,
              maxAge: 30 * 60 * 1000,
            });

            res.set("x-access-token", newAccessToken);

            const userObj = dbUser.toObject();
            delete userObj.password;
            delete userObj.refreshToken;
            await cacheUser(dbUser._id.toString(), userObj);

            req.user = userObj;
            req.user.userId = dbUser._id.toString();
            return next();
          } catch {
            return res.status(401).json({ message: "Token expired. Please sign in again." });
          }
        } else {
          return res.status(401).json({ message: "Invalid token" });
        }
      }
    } else {
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const refreshDecoded = jwt.verify(refreshToken, refreshSecret);
      if (refreshDecoded.type !== "refresh") return res.status(401).json({ message: "Invalid refresh token type" });
      decoded = refreshDecoded;
    }

    const platform = req.headers['x-app-platform'];
    req.isWeb = !platform || platform === 'web';

    const cachedUser = await getUserFromCache(decoded.userId);
    if (cachedUser) {
      if (req.isWeb && (!cachedUser.subscription?.revenueCatId || cachedUser.subscription?.status !== 'active')) {
        cachedUser.subscription.plan = "free";
      } else if (cachedUser.subscription?.status !== "active") {
        cachedUser.subscription.plan = "free";
      }
      req.user = cachedUser;
      req.user.userId = cachedUser._id.toString();
      return next();
    }

    user = await User.findById(decoded.userId).select("-password -refreshToken");

    if (!user) return res.status(401).json({ message: "User not found" });

    const userObj = user.toObject();

    if (req.isWeb && (!userObj.subscription?.revenueCatId || userObj.subscription?.status !== 'active')) {
      userObj.subscription.plan = "free";
    } else if (userObj.subscription?.status !== "active") {
      userObj.subscription.plan = "free";
    }

    await cacheUser(userObj._id.toString(), userObj);
    updateLastActive(userObj._id.toString());

    req.user = userObj;
    req.user.userId = userObj._id.toString();
    next();
  } catch {
    return res.status(401).json({ message: "Token is not valid" });
  }
};

export const optionalProtect = async (req, res, next) => {
  let token = req.cookies["unlock-me-token"];
  if (!token && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type !== "access") throw new Error();
      const cached = await getUserFromCache(decoded.userId);
      if (cached) {
        req.user = cached;
        req.user.userId = cached._id.toString();
      } else {
        const userDoc = await User.findById(decoded.userId).select("-password -refreshToken");
        if (userDoc) {
          const userObj = userDoc.toObject();
          await cacheUser(decoded.userId, userObj);
          req.user = userObj;
          req.user.userId = userObj._id.toString();
        }
      }
    } catch {
      req.user = null;
    }
  }
  next();
};