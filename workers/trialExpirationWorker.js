import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";

const trialExpirationProcessor = async () => {
  const startTime = Date.now();

  const now = new Date();
  
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

  return { success: true, modifiedCount: result.modifiedCount, duration };
};

const trialExpirationWorker = new Worker("trial-expiration-queue", trialExpirationProcessor, {
    connection: bullMQConnection,
    concurrency: 1,
});

export default trialExpirationWorker;
