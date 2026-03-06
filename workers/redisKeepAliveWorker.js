import "dotenv/config";
import cron from "node-cron";
import redisClient from "../config/redis.js";

/**
 * ✅ Fix 8: Redis Keep-Alive Worker
 * این worker هر 6 ساعت یکبار Redis رو فعال نگه می‌داره
 * تا دیتابیس حذف نشه
 */

let isRunning = false;

// ✅ Run every 5 minutes — must be shorter than cloud LB idle timeout (~10-15 min)
// Previous: every 6 hours — was completely ineffective against TCP idle drops (ECONNRESET)
cron.schedule("*/5 * * * *", async () => {
  if (isRunning) {
    console.log("⏰ Redis Keep-Alive: Already running, skipping...");
    return;
  }
  
  isRunning = true;
  
  try {
    console.log("🔄 Redis Keep-Alive Job Started...");
    
    // Check if Redis is configured
    if (!process.env.REDIS_URL) {
      console.warn("⚠️ REDIS_URL not configured. Skipping keep-alive.");
      return;
    }
    
    // Check if Redis client is available and connected
    if (!redisClient || !redisClient.isOpen) {
      console.warn("⚠️ Redis client not connected. Attempting to connect...");
      try {
        await redisClient.connect();
      } catch (connectError) {
        console.error("❌ Failed to connect to Redis:", connectError.message);
        return;
      }
    }
    
    // Perform keep-alive operations
    const timestamp = new Date().toISOString();
    const keepAliveKey = 'unlock-me:keep-alive';
    
    // Write a key
    await redisClient.set(keepAliveKey, timestamp);
    
    // Read the key
    const value = await redisClient.get(keepAliveKey);
    
    // Set TTL to 7 days
    await redisClient.expire(keepAliveKey, 7 * 24 * 60 * 60);
    
    console.log(`✅ Redis Keep-Alive Completed: ${value}`);
    
  } catch (error) {
    console.error("❌ Redis Keep-Alive Error:", error.message);
  } finally {
    isRunning = false;
  }
});

// Also run on server start (after 30 seconds delay)
setTimeout(async () => {
  if (process.env.REDIS_URL) {
    try {
      console.log("🔄 Running initial Redis Keep-Alive...");
      const timestamp = new Date().toISOString();
      const keepAliveKey = 'unlock-me:keep-alive';
      
      if (redisClient && redisClient.isOpen) {
        await redisClient.set(keepAliveKey, timestamp);
        await redisClient.expire(keepAliveKey, 7 * 24 * 60 * 60);
        console.log("✅ Initial Redis Keep-Alive completed");
      }
    } catch (error) {
      console.error("❌ Initial Redis Keep-Alive failed:", error.message);
    }
  }
}, 30000); // 30 seconds delay
