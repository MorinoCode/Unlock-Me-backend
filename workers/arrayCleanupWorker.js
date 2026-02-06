/**
 * ✅ Bug Fix: Array Cleanup Worker
 * Runs daily to clean up large arrays and prevent memory leaks
 */

import cron from "node-cron";
import User from "../models/User.js";
import { cleanupUserArrays } from "../utils/arrayLimiter.js";

let isRunning = false;

cron.schedule("0 2 * * *", async () => {
  if (isRunning) {
    console.log("⏰ Array Cleanup: Already running, skipping...");
    return;
  }
  
  isRunning = true;
  const startTime = Date.now();
  
  try {
    console.log("🧹 Array Cleanup Job Started...");
    
    // Get all users with large arrays
    const users = await User.find({
      $or: [
        { $expr: { $gt: [{ $size: "$likedUsers" }, 5000] } },
        { $expr: { $gt: [{ $size: "$dislikedUsers" }, 20000] } },
        { $expr: { $gt: [{ $size: "$potentialMatches" }, 500] } },
        { $expr: { $gt: [{ $size: "$matches" }, 5000] } }
      ]
    }).select("_id").lean();
    
    console.log(`📊 Found ${users.length} users with large arrays`);
    
    let cleaned = 0;
    for (const user of users) {
      try {
        await cleanupUserArrays(user._id);
        cleaned++;
        if (cleaned % 10 === 0) {
          console.log(`📊 Progress: ${cleaned}/${users.length} users cleaned...`);
        }
      } catch (error) {
        console.error(`❌ Error cleaning user ${user._id}:`, error.message);
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Array Cleanup Completed: Cleaned ${cleaned} users in ${duration}s`);
    
  } catch (error) {
    console.error("❌ Array Cleanup Error:", error);
  } finally {
    isRunning = false;
  }
});
