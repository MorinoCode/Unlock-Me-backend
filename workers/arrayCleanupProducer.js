import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";
import { arrayCleanupQueue } from "../config/queue.js";

const arrayCleanupProducerProcessor = async () => {
  const users = await User.find({
    $or: [
      { $expr: { $gt: [{ $size: "$likedUsers" }, 5000] } },
      { $expr: { $gt: [{ $size: "$dislikedUsers" }, 20000] } },
      { $expr: { $gt: [{ $size: "$potentialMatches" }, 500] } },
      { $expr: { $gt: [{ $size: "$matches" }, 5000] } }
    ]
  }).select("_id").limit(1000).lean();
  
  for (const user of users) {
    await arrayCleanupQueue.add("array-cleanup-job", { userId: user._id.toString() }, {
      jobId: `array-cleanup-${user._id.toString()}-${Date.now()}`
    });
  }

  return { success: true, queued: users.length };
};

const arrayCleanupProducer = new Worker("array-cleanup-producer-queue", arrayCleanupProducerProcessor, {
    connection: bullMQConnection,
    concurrency: 1,
});

export default arrayCleanupProducer;
