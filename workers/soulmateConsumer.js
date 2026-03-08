import { Worker } from "bullmq";
import User from "../models/User.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
import { calculateCompatibility } from "../utils/matchUtils.js";
import { getSoulmatePermissions } from "../utils/subscriptionRules.js";

const soulmateConsumerProcessor = async (job) => {
  const { userId } = job.data;

  try {
    const user = await User.findById(userId).lean();
    if (!user) return { success: false };

    const plan = user.subscription?.plan;
    const permissions = getSoulmatePermissions(plan);
    
    if (permissions.isLocked || permissions.limit === 0) {
      return { success: false };
    }

    const excludedIds = [
      user._id,
      ...(user.matches || []),
      ...(user.likedUsers || []),
      ...(user.dislikedUsers || []),
      ...(user.blockedUsers || []),
    ];

    const query = {
      _id: { $nin: excludedIds },
      "location.country": user.location?.country,
      dna: { $exists: true, $ne: null },
      "dna.Logic": { $exists: true, $type: "number" },
    };

    if (user.lookingFor) query.gender = user.lookingFor;

    const fetchSize = permissions.limit * 10;
    
    const candidates = await User.find(query)
      .select("dna questionsbycategoriesResults interests location gender birthday")
      .limit(fetchSize)
      .lean();

    if (!candidates.length) return { success: false };

    const scored = candidates
      .map((c) => ({ user: c._id, score: calculateCompatibility(user, c) }))
      .filter((c) => c.score >= 90)
      .sort((a, b) => b.score - a.score)
      .slice(0, permissions.limit);

    if (scored.length > 0) {
      await User.findByIdAndUpdate(user._id, {
        $set: {
          "soulmateMatches.list": scored,
          "soulmateMatches.calculatedAt": new Date(),
        },
      });

      await redisClient.del(`soulmates:${user._id}`).catch(() => {});
    }

    return { success: true };
  } catch (error) {
    throw error;
  }
};

const soulmateConsumer = new Worker("soulmate-consumer-queue", soulmateConsumerProcessor, {
  connection: bullMQConnection,
  concurrency: 5,
});

export default soulmateConsumer;
