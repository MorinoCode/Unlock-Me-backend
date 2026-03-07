/**
 * soulmateWorker.js
 * ─────────────────
 * Weekly background job: Pre-computes soulmate lists for active users.
 *
 * Runs via cron: once per week (Sunday 2:00 AM UTC).
 * Only processes users who are:
 *   1. Active in the last 48 hours
 *   2. On a paid plan (GOLD / PLATINUM / DIAMOND)
 *   3. Either never had soulmates computed, or data is > 7 days old
 *
 * Candidate fetch limits (to keep CPU low):
 *   GOLD      → 5  soulmates → fetch max  50 candidates
 *   PLATINUM  → 10 soulmates → fetch max 100 candidates
 *   DIAMOND   → 40 soulmates → fetch max 200 candidates
 *
 * After computing, results are stored in User.soulmateMatches
 * and the Redis key is invalidated so the next read is fresh.
 */

import User from "../models/User.js";
import redisClient from "../config/redis.js";
import { calculateCompatibility } from "../utils/matchUtils.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAN_CONFIG = {
  gold:     { limit: 5,  fetchSize: 50  },
  platinum: { limit: 10, fetchSize: 100 },
  diamond:  { limit: 40, fetchSize: 200 },
};

const BATCH_SIZE      = 50;           // users processed per batch
const BATCH_DELAY_MS  = 200;          // pause between batches (ms) — keeps CPU cool
const STALE_DAYS      = 7;            // recompute after 7 days
const ACTIVE_HOURS    = 48;           // only process users active in last 48h

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Core: compute soulmates for a single user ───────────────────────────────

async function computeSoulmatesForUser(user) {
  const plan = user.subscription?.plan?.toLowerCase() || "free";
  const config = PLAN_CONFIG[plan];
  if (!config) return; // FREE — skip silently

  // ✅ Guard: skip if list is already at cap AND was computed within 7 days
  const existing = user.soulmateMatches;
  if (existing?.list?.length >= config.limit && existing?.calculatedAt) {
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000);
    if (new Date(existing.calculatedAt) > staleCutoff) {
      return; // Already full and fresh — no computation needed
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

  // Fetch only what we need — lean + minimal projection
  const candidates = await User.find(query)
    .select("dna questionsbycategoriesResults interests location gender birthday")
    .limit(config.fetchSize)
    .lean();

  if (!candidates.length) return;

  // Score, filter to 90+, take only up to plan limit — no more
  const scored = candidates
    .map((c) => ({ user: c._id, score: calculateCompatibility(user, c) }))
    .filter((c) => c.score >= 90)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.limit); // ✅ Hard cap per plan

  if (!scored.length) return;

  // Persist to MongoDB
  await User.findByIdAndUpdate(user._id, {
    $set: {
      "soulmateMatches.list":         scored,
      "soulmateMatches.calculatedAt": new Date(),
    },
  });

  // Invalidate Redis so next client read fetches fresh data
  await redisClient.del(`soulmates:${user._id}`).catch(() => {});
}

// ─── Main exported runner ──────────────────────────────────────────────────

export async function runSoulmateWorker() {
  const startTime  = Date.now();
  const staleCutoff  = getStaleCutoff();
  const activeCutoff = getActiveCutoff();

  console.log("\n════════════════════════════════════════");
  console.log("[SoulmateWorker] 🚀 Starting weekly run...");
  console.log(`[SoulmateWorker] Active cutoff  : ${activeCutoff.toISOString()}`);
  console.log(`[SoulmateWorker] Stale cutoff   : ${staleCutoff.toISOString()}`);
  console.log("════════════════════════════════════════\n");

  // Query: active paid users whose soulmate data is stale
  const eligibleQuery = {
    lastActiveAt:              { $gte: activeCutoff },
    "subscription.plan":       { $in: ["gold", "platinum", "diamond"] },
    $or: [
      { "soulmateMatches.calculatedAt": null                    },
      { "soulmateMatches.calculatedAt": { $lt: staleCutoff }   },
    ],
  };

  const totalCount = await User.countDocuments(eligibleQuery);
  console.log(`[SoulmateWorker] Eligible users: ${totalCount}`);

  if (totalCount === 0) {
    console.log("[SoulmateWorker] ✅ Nothing to process. Exiting.");
    return;
  }

  let processed = 0;
  let errors    = 0;
  let skip      = 0;

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
        console.error(`[SoulmateWorker] ❌ Error for user ${user._id}:`, err.message);
      }
    }

    skip += BATCH_SIZE;
    console.log(`[SoulmateWorker] Progress: ${Math.min(skip, totalCount)} / ${totalCount}`);

    // Breathe between batches — keeps CPU free for serving requests
    await sleep(BATCH_DELAY_MS);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n════════════════════════════════════════");
  console.log(`[SoulmateWorker] ✅ Done in ${durationSec}s`);
  console.log(`[SoulmateWorker] Processed : ${processed}`);
  console.log(`[SoulmateWorker] Errors    : ${errors}`);
  console.log("════════════════════════════════════════\n");
}
