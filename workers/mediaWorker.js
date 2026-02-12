import { Worker } from "bullmq";
import User from "../models/User.js";
import cloudinary from "../config/cloudinary.js";
import redisClient from "../config/redis.js";
import { invalidateUserCache, invalidateMatchesCache } from "../utils/cacheHelper.js";
import { invalidateUserCaches } from "../utils/redisMatchHelper.js";
import { dispatchExploreSync } from "../utils/workerDispatcher.js";

const workerHandler = async (job) => {
  const { type, userId, data } = job.data;
  console.log(`[MediaWorker] Processing ${type} for user: ${userId}`);

  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    let updateData = {};

    if (type === "UPLOAD_AVATAR") {
      const { avatarBase64 } = data;
      // Delete old avatar if it's not the default
      if (user.avatar && !user.avatar.includes("default-avatar")) {
        const publicId = user.avatar.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/)?.[1];
        if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
      }

      const uploadRes = await cloudinary.uploader.upload(avatarBase64, {
        folder: "unlock_me_avatars",
        transformation: [{ width: 500, height: 500, crop: "fill" }],
      });
      updateData.avatar = uploadRes.secure_url;

    } else if (type === "UPLOAD_VOICE") {
      const { voiceBase64 } = data;
      // Delete old voice
      if (user.voiceIntro) {
        const publicId = user.voiceIntro.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/)?.[1];
        if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: "video" }).catch(() => {});
      }

      // Convert base64 to buffer
      const base64Data = voiceBase64.split('base64,')[1];
      const audioBuffer = Buffer.from(base64Data, 'base64');

      const uploadPromise = new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { resource_type: "video", folder: "unlock_me_voices", public_id: `voice_${userId}_${Date.now()}` },
          (error, result) => error ? reject(error) : resolve(result)
        ).end(audioBuffer);
      });

      const uploadRes = await uploadPromise;
      updateData.voiceIntro = uploadRes.secure_url;

    } else if (type === "UPLOAD_GALLERY") {
      const { images } = data; // Array of mixed URLs and Base64
      
      const processedImages = await Promise.all(
        images.map(async (img) => {
          if (img.startsWith("data:image")) {
            const uploadRes = await cloudinary.uploader.upload(img, {
              folder: "unlock_me_gallery",
              transformation: [{ width: 800, crop: "limit" }]
            });
            return uploadRes.secure_url;
          }
          return img;
        })
      );
      updateData.gallery = processedImages;
    }

    // Save to DB
    const oldUser = user.toObject();
    await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true }).select("-password");

    // Invalidate Caches
    await Promise.all([
      invalidateUserCache(userId),
      invalidateMatchesCache(userId, "profile_full"),
      invalidateUserCaches(userId),
      dispatchExploreSync(userId, oldUser),
    ]).catch(() => {});

    // Notify via Redis Pub/Sub for real-time UI refresh
    await redisClient.publish("job-events", JSON.stringify({
      type: "MEDIA_PROCESSED",
      userId: userId.toString(),
      mediaType: type,
      payload: updateData
    }));

    return { success: true, userId, updatedFields: Object.keys(updateData) };
  } catch (error) {
    console.error(`❌ [MediaWorker] Error:`, error);
    throw error;
  }
};

const mediaWorker = new Worker("media-queue", workerHandler, {
  connection: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
  },
  concurrency: 10,
});

mediaWorker.on("failed", (job, err) => {
  console.error(`🚨 [MediaWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [MediaWorker] Worker Started & Listening...");

export default mediaWorker;
