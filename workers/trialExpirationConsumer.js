import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";
import { PLANS } from "../utils/subscriptionRules.js";

const trialExpirationConsumerProcessor = async (job) => {
  const { userId } = job.data;
  
  const user = await User.findById(userId).lean();
  if (!user) return { success: false };

  if (user.subscription?.isTrial === true && (!user.subscription?.plan || user.subscription.plan === PLANS.FREE)) {
    await User.findByIdAndUpdate(userId, {
      $set: {
        "subscription.plan": PLANS.FREE,
        "subscription.status": "active",
        "subscription.isTrial": false,
        "subscription.trialExpiresAt": null,
        "subscription.expiresAt": null
      }
    });
  }
  
  return { success: true };
};

const trialExpirationConsumer = new Worker("trial-expiration-queue", trialExpirationConsumerProcessor, {
    connection: bullMQConnection,
    concurrency: 5,
});

export default trialExpirationConsumer;
