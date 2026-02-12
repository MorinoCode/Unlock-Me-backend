import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

// ✅ Shared connection config for BullMQ & redis client
export const redisConnectionConfig = process.env.REDIS_URL
  ? {
      url: process.env.REDIS_URL,
      socket: {
        tls: process.env.REDIS_URL.startsWith("rediss://"),
        connectTimeout: 50000,
        keepAlive: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 30) {
            console.error("❌ Redis: Max retries exceeded. Giving up.");
            return new Error("Max retries exceeded");
          }
          return Math.min(retries * 100, 3000);
        }
      }
    }
  : {
      socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
      }
    };

const redisClient = createClient(redisConnectionConfig);

// ✅ BullMQ connection (URL string is easiest for ioredis/BullMQ)
export const bullMQConnection = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

if (redisClient) {
  redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error:", err.message);
  });

  redisClient.on("connect", () => {
    console.log("✅ Connected to Redis successfully! 🚀");
  });

  (async () => {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error.message);
      console.warn("⚠️ Server will continue without Redis features.");
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
