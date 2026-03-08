import { Worker } from "bullmq";
import User from "../models/User.js";
import { bullMQConnection } from "../config/redis.js";
import { soulmateConsumerQueue } from "../config/queue.js";

const STALE_DAYS = 7;
const ACTIVE_HOURS = 48;

function getStaleCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - STALE_DAYS);
  return d;
}

function getActiveCutoff() {
  const d = new Date();
  d.setHours(d.getHours() - ACTIVE_HOURS);
  return d;
}

const soulmateProducerProcessor = async () => {
  const staleCutoff = getStaleCutoff();
  const activeCutoff = getActiveCutoff();

  const eligibleQuery = {
    lastActiveAt: { $gte: activeCutoff },
    "subscription.plan": { $in: ["gold", "platinum", "diamond"] },
    $or: [
      { "soulmateMatches.calculatedAt": null },
      { "soulmateMatches.calculatedAt": { $lt: staleCutoff } },
    ],
  };

  const eligibleUsers = await User.find(eligibleQuery)
    .select("_id")
    .limit(1000)
    .lean();

  for (const user of eligibleUsers) {
    await soulmateConsumerQueue.add("soulmate-match-job", { userId: user._id.toString() }, {
      jobId: `soulmate-match-${user._id.toString()}-${Date.now()}`
    });
  }

  return { success: true, queued: eligibleUsers.length };
};

const soulmateProducer = new Worker("soulmate-producer-queue", soulmateProducerProcessor, {
    connection: bullMQConnection,
    concurrency: 1,
});

export default soulmateProducer;
