import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

// ✅ Fix 1: Check if REDIS_URL exists
if (!process.env.REDIS_URL) {
  console.warn(
    "⚠️ REDIS_URL not found in environment variables. Redis features will be disabled."
  );
}

const redisClient = process.env.REDIS_URL
  ? createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 50000, 
        keepAlive: 5000,
        reconnectStrategy: (retries) => {
            if (retries > 20) {
                console.error("Redis: Max retries exceeded. Giving up.");
                return new Error("Max retries exceeded");
            }
            return Math.min(retries * 50, 2000);
        }
      }
    })
  : null;

if (redisClient) {
  redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error:", err.message);
    // Don't crash the server, just log the error
  });

  redisClient.on("connect", () => {
    console.log("✅ Connected to Redis Cloud successfully! 🚀");
  });

  // ✅ Fix 1: Proper error handling for connection
  (async () => {
    try {
      if (redisClient && !redisClient.isOpen) {
        await redisClient.connect();
      }
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error.message);
      console.warn(
        "⚠️ Server will continue without Redis. Blind Date features may not work."
      );
    }
  })();
}

// Export a safe wrapper that handles null redisClient
export default redisClient || {
  isOpen: false,
  connect: async () => {
    console.warn("Redis not configured");
  },
  lRange: async () => [],
  lPush: async () => 0,
  lRem: async () => 0,
  quit: async () => {},
  get: async () => null,
  set: async () => "OK",
  expire: async () => 0,
  info: async () => "",
  // ✅ Added for optimized match system
  zadd: async () => 0,
  zrevrange: async () => [],
  zremrangebyrank: async () => 0,
  sadd: async () => 0,
  sismember: async () => false,
  del: async () => 0,
  multi: () => ({
    zadd: () => {},
    sadd: () => {},
    exec: async () => [],
  }),
};
