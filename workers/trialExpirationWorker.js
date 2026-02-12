/**
 * ✅ 7-Day Platinum Trial Expiration Worker
 * Runs daily to check for expired trials and downgrade users to free plan.
 */

import cron from "node-cron";
import User from "../models/User.js";

let isRunning = false;

// Run every hour to ensure timely downgrades
cron.schedule("0 * * * *", async () => {
  if (isRunning) {
    console.log("⏰ Trial Expiration: Already running, skipping...");
    return;
  }
  
  isRunning = true;
  const startTime = Date.now();
  
  try {
    console.log("⏳ Trial Expiration Job Started...");
    
    const now = new Date();
    
    // Find users whose trial has expired
    const result = await User.updateMany(
      {
        "subscription.isTrial": true,
        "subscription.trialExpiresAt": { $lte: now }
      },
      {
        $set: {
          "subscription.plan": "free",
          "subscription.status": "active",
          "subscription.isTrial": false,
          "subscription.trialExpiresAt": null,
          "subscription.expiresAt": null
        }
      }
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    if (result.modifiedCount > 0) {
      console.log(`✅ Trial Expiration Completed: Downgraded ${result.modifiedCount} users in ${duration}s`);
    } else {
      console.log(`⌛ Trial Expiration Completed: No expired trials found. (${duration}s)`);
    }
    
  } catch (error) {
    console.error("❌ Trial Expiration Error:", error);
  } finally {
    isRunning = false;
  }
});
