import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

// ✅ Aggressive Detection: Check all common names and clean the string
const rawUrl = (
  process.env.REDIS_URL || 
  process.env.REDIS_URI || 
  process.env.REDIS_INTERNAL_URL || 
  process.env.REDIS_EXTERNAL_URL || 
  process.env.REDIS_SERVICE_URL ||
  ""
).trim().replace(/^["'](.*)["']$/, '$1');

console.log("\n--- [CRITICAL REDIS DEBUG] ---");
console.log("Current NODE_ENV:", process.env.NODE_ENV);
console.log("Detected URL (masked):", rawUrl ? (rawUrl.substring(0, 15) + "...") : "NONE");

// Log all keys starting with REDIS (masked) to help find the correct one
const envKeys = Object.keys(process.env);
console.log("Available REDIS-related env keys:");
envKeys.filter(k => k.toUpperCase().includes("REDIS")).forEach(k => {
  const val = process.env[k];
  console.log(`- ${k}: ${val ? (val.substring(0, 8) + "...") : "empty"}`);
});

if (!rawUrl) {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ CRITICAL ERROR: No Redis URL found in production environment!");
    console.error("Please ensure REDIS_URL or REDIS_URI is set in Render Dashboard.");
    // In production, we should arguably crash early to avoid silent failures
    // throw new Error("Missing Redis configuration in production");
  } else {
    console.log("⚠️ INFO: Falling back to localhost/env-parts for development.");
  }
}
console.log("------------------------------\n");

// ✅ Shared connection config for BullMQ & redis client
export const redisConnectionConfig = rawUrl
  ? {
      url: rawUrl,
      socket: {
        tls: rawUrl.toLowerCase().startsWith("rediss://"),
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
        port: parseInt(process.env.REDIS_PORT) || 6379,
      }
    };

// ✅ Parse URL for BullMQ (ioredis compatibility)
let parsedBullMQConnection = null;
if (rawUrl) {
  try {
    const url = new URL(rawUrl);
    parsedBullMQConnection = {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === "rediss:" ? 6380 : 6379),
      password: url.password,
      username: url.username !== "default" ? url.username : undefined, // ioredis/BullMQ handles default username
      tls: url.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null, // Critical for BullMQ
    };
    console.log(`📡 [Redis] Parsed BullMQ Connection: ${parsedBullMQConnection.host}:${parsedBullMQConnection.port} (TLS: ${!!parsedBullMQConnection.tls})`);
  } catch (err) {
    console.error("❌ Failed to parse REDIS_URL for BullMQ:", err.message);
    parsedBullMQConnection = rawUrl; // Fallback to raw string
  }
}

// ✅ BullMQ connection (ioredis standard)
// ⚠️  keepAlive (ms): Enables TCP SO_KEEPALIVE at socket level.
//    This prevents cloud LB/firewalls from silently dropping idle connections (ECONNRESET).
//    5000ms = send a TCP keepalive probe every 5 seconds on idle connections.
export const bullMQConnection = parsedBullMQConnection
  ? { ...parsedBullMQConnection, keepAlive: 5000 }
  : {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
      keepAlive: 5000,
      ...(parseInt(process.env.REDIS_PORT) === 6380 && { tls: {} })
    };


console.log("📦 [Redis] Final bullMQConnection host:", bullMQConnection.host ? (bullMQConnection.host.substring(0, 5) + "...") : "NOT SET");
console.log("------------------------------\n");

const redisClient = createClient(redisConnectionConfig);

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
