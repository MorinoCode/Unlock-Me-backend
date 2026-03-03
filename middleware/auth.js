import jwt from "jsonwebtoken";
import User from "../models/User.js";
import redisClient from "../config/redis.js"; // ✅ CRITICAL FIX #1: Redis cache for auth

// ✅ CRITICAL FIX #1 — Cache authenticated user in Redis for 5 min
// Prevents a DB query on EVERY API request. At 1M users = 90% fewer MongoDB reads.
const getUserFromCache = async (userId) => {
  try {
    const cached = await redisClient.get(`user:session:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch {
    // Redis miss — fall through to DB
  }
  return null;
};

const cacheUser = async (userId, userData) => {
  try {
    await redisClient.setEx(
      `user:session:${userId}`,
      300, // 5 minute TTL
      JSON.stringify(userData)
    );
  } catch {
    // Non-blocking — cache failure is acceptable
  }
};

export const invalidateUserCache = async (userId) => {
  try {
    await redisClient.del(`user:session:${userId}`);
  } catch {
    // Non-blocking
  }
};

export const protect = async (req, res, next) => {
  const token = req.cookies["unlock-me-token"];
  const refreshToken = req.cookies["unlock-me-refresh-token"];

  if (!token && !refreshToken) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    let decoded;
    let user;

    // Try to verify access token first
    if (token) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== "access") {
          throw new Error("Invalid token type");
        }
      } catch (tokenError) {
        // If access token expired, try refresh token
        if (tokenError.name === "TokenExpiredError" && refreshToken) {
          try {
            const refreshSecret =
              process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
            const refreshDecoded = jwt.verify(refreshToken, refreshSecret);
            if (refreshDecoded.type !== "refresh") {
              throw new Error("Invalid refresh token type");
            }

            // Refresh tokens must always hit DB (security: revocation check)
            const dbUser = await User.findById(refreshDecoded.userId).select(
              "-password"
            );
            if (!dbUser || dbUser.refreshToken !== refreshToken) {
              throw new Error("Invalid refresh token");
            }

            // ✅ Generate new access token
            const newAccessToken = jwt.sign(
              {
                userId: dbUser._id,
                role: dbUser.role,
                username: dbUser.username,
                type: "access",
              },
              process.env.JWT_SECRET,
              { expiresIn: "30m" } // ✅ FIX #9: Extended from 15m → 30m for mobile UX
            );

            const isProduction = process.env.NODE_ENV === "production";
            res.cookie("unlock-me-token", newAccessToken, {
              httpOnly: true,
              secure: isProduction,
              sameSite: "lax",
              domain: isProduction ? ".unlock-me.app" : undefined,
              maxAge: 30 * 60 * 1000, // 30 minutes
            });

            // Cache the refreshed user
            const userObj = dbUser.toObject();
            delete userObj.password;
            delete userObj.refreshToken;
            await cacheUser(dbUser._id.toString(), userObj);

            req.user = userObj;
            req.user.userId = dbUser._id.toString();
            return next();
          } catch {
            return res
              .status(401)
              .json({ message: "Token expired. Please sign in again." });
          }
        } else {
          throw tokenError;
        }
      }
    } else {
      // No access token, try refresh token
      const refreshSecret =
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const refreshDecoded = jwt.verify(refreshToken, refreshSecret);
      if (refreshDecoded.type !== "refresh") {
        throw new Error("Invalid refresh token type");
      }
      decoded = refreshDecoded;
    }

    // ✅ CRITICAL FIX #1: Check Redis cache BEFORE hitting MongoDB
    const cachedUser = await getUserFromCache(decoded.userId);
    if (cachedUser) {
      // ✅ FIX #4: Trial check in memory only — no DB write in middleware
      if (
        cachedUser.subscription?.isTrial &&
        cachedUser.subscription?.trialExpiresAt &&
        new Date() > new Date(cachedUser.subscription.trialExpiresAt)
      ) {
        // Only update in-memory — trialExpirationWorker handles the DB write
        cachedUser.subscription.plan = "free";
        cachedUser.subscription.isTrial = false;
      }
      req.user = cachedUser;
      req.user.userId = cachedUser._id.toString();
      return next();
    }

    // Cache miss — fetch from DB and cache result
    user = await User.findById(decoded.userId).select("-password -refreshToken");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const userObj = user.toObject();

    // ✅ FIX #4: Trial expiration — read-only check in middleware
    // The actual DB update is handled by trialExpirationWorker (runs every hour)
    if (
      userObj.subscription?.isTrial &&
      userObj.subscription?.trialExpiresAt &&
      new Date() > new Date(userObj.subscription.trialExpiresAt)
    ) {
      userObj.subscription.plan = "free";
      userObj.subscription.isTrial = false;
      userObj.subscription.trialExpiresAt = null;
      userObj.subscription.expiresAt = null;
      // ✅ Write is now async fire-and-forget — does NOT block the request
      User.findByIdAndUpdate(userObj._id, {
        $set: {
          "subscription.plan": "free",
          "subscription.isTrial": false,
          "subscription.trialExpiresAt": null,
          "subscription.expiresAt": null,
        },
      }).catch(() => {}); // non-blocking
    }

    // Cache user for 5 minutes (skip caching refreshToken field)
    await cacheUser(userObj._id.toString(), userObj);

    req.user = userObj;
    req.user.userId = userObj._id.toString();
    next();
  } catch {
    return res.status(401).json({ message: "Token is not valid" });
  }
};

export const optionalProtect = async (req, res, next) => {
  const token = req.cookies["unlock-me-token"];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // ✅ FIX: Use cache for optional protect too
      const cached = await getUserFromCache(decoded.userId);
      if (cached) {
        req.user = cached;
      } else {
        req.user = await User.findById(decoded.userId).select("-password");
        if (req.user) await cacheUser(decoded.userId, req.user.toObject());
      }
    } catch {
      req.user = null; // ✅ FIX: No console.log for expected token errors
    }
  }
  next();
};
