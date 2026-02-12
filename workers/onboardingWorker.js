import { Worker } from "bullmq";
import User from "../models/User.js";
import redisClient from "../config/redis.js";
import { calculateUserDNA } from "../utils/matchUtils.js";
import { invalidateMatchesCache } from "../utils/cacheHelper.js";

const workerHandler = async (job) => {
  const { type, userId, data } = job.data;
  console.log(`[OnboardingWorker] Processing ${type} for user: ${userId}`);

  try {
    if (type === "PROCESS_QUIZ_RESULTS") {
      const { updateQuery, categoryNames } = data;
      
      const totalAnswers = Object.values(updateQuery).reduce((acc, cat) => acc + (cat?.length || 0), 0);
      console.log(`[OnboardingWorker] Saving ${totalAnswers} answers for ${categoryNames.length} categories for user ${userId}`);

      // 1. Update Database
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $set: updateQuery,
          $addToSet: { interests: { $each: categoryNames } },
        },
        { new: true }
      );

      if (!updatedUser) throw new Error("User not found during quiz processing");

      // 2. Calculate DNA
      const newDNA = calculateUserDNA(updatedUser, true);
      await User.findByIdAndUpdate(userId, { dna: newDNA });

      // 3. Cleanup Cache
      await Promise.all([
        invalidateMatchesCache(userId, "user_interests"),
        invalidateMatchesCache(userId, "profile_full"),
        invalidateMatchesCache(userId, "user_dna"),
      ]).catch(() => {});

      // 4. Notify via Redis
      await redisClient.publish("job-events", JSON.stringify({
        type: "ONBOARDING_PROCESSED",
        userId: userId.toString(),
        payload: { dna: newDNA, categoriesSaved: categoryNames }
      }));

      return { success: true, dna: newDNA };
    }
  } catch (error) {
    console.error(`❌ [OnboardingWorker] Error:`, error);
    throw error;
  }
};

const onboardingWorker = new Worker("onboarding-queue", workerHandler, {
  connection: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
  },
  concurrency: 5,
});

onboardingWorker.on("failed", (job, err) => {
  console.error(`🚨 [OnboardingWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [OnboardingWorker] Worker Started & Listening...");

export default onboardingWorker;
