import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";
import { trialExpirationQueue } from "../config/queue.js";

const trialExpirationProducerProcessor = async () => {
  const now = new Date();
  
  const users = await User.find({
    "subscription.isTrial": true,
    "subscription.trialExpiresAt": { $lte: now }
  }).select("_id").limit(1000).lean();
  
  for (const user of users) {
    await trialExpirationQueue.add("trial-expiration-job", { userId: user._id.toString() }, {
      jobId: `trial-expiration-${user._id.toString()}-${Date.now()}`
    });
  }

  return { success: true, queued: users.length };
};

const trialExpirationProducer = new Worker("trial-expiration-producer-queue", trialExpirationProducerProcessor, {
    connection: bullMQConnection,
    concurrency: 1,
});

export default trialExpirationProducer;
