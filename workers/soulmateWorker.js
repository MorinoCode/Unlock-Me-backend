import { Worker } from "bullmq";
import User from "../models/User.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
import { calculateCompatibility } from "../utils/matchUtils.js";

const PLAN_CONFIG = {
  gold:     { limit: 5,  fetchSize: 50  },
  platinum: { limit: 10, fetchSize: 100 },
  diamond:  { limit: 40, fetchSize: 200 },
};

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;
const STALE_DAYS = 7;
const ACTIVE_HOURS = 48;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function computeSoulmatesForUser(user) {
  const plan = user.subscription?.plan?.toLowerCase() || "free";
  const config = PLAN_CONFIG[plan];
  if (!config) return;

  const existing = user.soulmateMatches;
  if (existing?.list?.length >= config.limit && existing?.calculatedAt) {
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000);
    if (new Date(existing.calculatedAt) > staleCutoff) {
      return;
    }
  }

  const excludedIds = [
    user._id,
    ...(user.matches       || []),
    ...(user.likedUsers    || []),
    ...(user.dislikedUsers || []),
    ...(user.blockedUsers  || []),
  ];

  const query = {
    _id:                { $nin: excludedIds },
    "location.country": user.location?.country,
    dna:                { $exists: true, $ne: null },
    "dna.Logic":        { $exists: true, $type: "number" },
  };
  
  if (user.lookingFor) query.gender = user.lookingFor;

  const candidates = await User.find(query)
    .select("dna questionsbycategoriesResults interests location gender birthday")
    .limit(config.fetchSize)
    .lean();

  if (!candidates.length) return;

  const scored = candidates
    .map((c) => ({ user: c._id, score: calculateCompatibility(user, c) }))
    .filter((c) => c.score >= 90)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.limit);

  if (!scored.length) return;

  await User.findByIdAndUpdate(user._id, {
    $set: {
      "soulmateMatches.list":         scored,
      "soulmateMatches.calculatedAt": new Date(),
    },
  });

  await redisClient.del(`soulmates:${user._id}`).catch(() => {});
}

const soulmateProcessor = async (job) => {
  const startTime = Date.now();
  const staleCutoff = getStaleCutoff();
  const activeCutoff = getActiveCutoff();

  const eligibleQuery = {
    lastActiveAt:              { $gte: activeCutoff },
    "subscription.plan":       { $in: ["gold", "platinum", "diamond"] },
    $or: [
      { "soulmateMatches.calculatedAt": null                    },
      { "soulmateMatches.calculatedAt": { $lt: staleCutoff }   },
    ],
  };

  const totalCount = await User.countDocuments(eligibleQuery);

  if (totalCount === 0) {
    return { success: true, processed: 0, totalEligible: 0 };
  }

  let processed = 0;
  let errors = 0;
  let skip = 0;

  while (skip < totalCount) {
    const batch = await User.find(eligibleQuery)
      .select(
        "subscription location lookingFor dna matches likedUsers dislikedUsers blockedUsers questionsbycategoriesResults soulmateMatches"
      )
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    if (!batch.length) break;

    for (const user of batch) {
      try {
        await computeSoulmatesForUser(user);
        processed++;
      } catch (err) {
        errors++;
      }
    }

    skip += BATCH_SIZE;
    await job.updateProgress(Math.floor((Math.min(skip, totalCount) / totalCount) * 100));
    await sleep(BATCH_DELAY_MS);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  return { success: true, processed, errors, durationSec };
};

const soulmateWorker = new Worker("soulmate-queue", soulmateProcessor, {
  connection: bullMQConnection,
  concurrency: 1,
  lockDuration: 300000,
});

export default soulmateWorker;
