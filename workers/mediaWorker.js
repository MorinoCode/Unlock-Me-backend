import { Worker } from "bullmq";
import User from "../models/User.js";
import cloudinary from "../config/cloudinary.js";
import redisClient, { bullMQConnection } from "../config/redis.js";
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

      console.log(`[MediaWorker] Sending avatar to Cloudinary for ${userId}...`);
      const uploadRes = await cloudinary.uploader.upload(avatarBase64, {
        folder: "unlock_me_avatars",
        transformation: [{ width: 500, height: 500, crop: "fill" }],
        format: "jpg", // ✅ Force JPG so AWS Rekognition works (it skips webp)
        moderation: "aws_rek", // ✅ Correct Cloudinary flag for AWS Rekognition
      });
      console.log(`[MediaWorker] Cloudinary upload success for ${userId}. Moderation length:`, uploadRes.moderation?.length);

      // ✅ Check Moderation Result
      if (uploadRes.moderation && uploadRes.moderation.length > 0) {
        const modStatus = uploadRes.moderation[0].status;
        if (modStatus === "rejected") {
           console.warn(`[MediaWorker] ⚠️ Avatar rejected for user ${userId}`);
           await cloudinary.uploader.destroy(uploadRes.public_id);
           
           // Notify Frontend
           await redisClient.publish("job-events", JSON.stringify({
             type: "MEDIA_REJECTED",
             userId: userId.toString(),
             mediaType: type,
             reason: "Inappropriate content detected"
           }));
           return { success: false, reason: "Moderation rejected" }; // Stop here, don't update DB
        }
      }

      updateData.avatar = uploadRes.secure_url;

    } else if (type === "UPLOAD_VOICE") {
      // Voice calls usually don't use image moderation, but we keep the flow
      const { voiceBase64 } = data;
      if (user.voiceIntro) {
        const publicId = user.voiceIntro.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/)?.[1];
        if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: "video" }).catch(() => {});
      }

      const base64Data = voiceBase64.split('base64,')[1];
      const audioBuffer = Buffer.from(base64Data, 'base64');

      const uploadPromise = new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { 
            resource_type: "video", // Keep as 'video' to correctly process mp4 containers
            folder: "unlock_me_voices", 
            public_id: `voice_${userId}_${Date.now()}`,
            format: "mp3" // Convert to MP3 for universal compatibility
          },
          (error, result) => error ? reject(error) : resolve(result)
        ).end(audioBuffer);
      });

      const uploadRes = await uploadPromise;
      updateData.voiceIntro = uploadRes.secure_url;

    } else if (type === "UPLOAD_GALLERY") {
      const { images } = data; 
      
      const processedImages = [];
      // rejectedCount tracking reserved for future moderation reporting

      for (const img of images) {
          if (img.startsWith("data:image")) {
            const uploadRes = await cloudinary.uploader.upload(img, {
              folder: "unlock_me_gallery",
              transformation: [{ width: 800, crop: "limit" }],
              format: "jpg", // ✅ Force JPG so AWS Rekognition works
              moderation: "aws_rek", // ✅ Correct Cloudinary flag for AWS Rekognition
            });

            // ✅ Check Moderation Result
            let isRejected = false;
            if (uploadRes.moderation && uploadRes.moderation.length > 0) {
                if (uploadRes.moderation[0].status === "rejected") {
                    console.warn(`[MediaWorker] ⚠️ Gallery image rejected for user ${userId}`);
                    await cloudinary.uploader.destroy(uploadRes.public_id);
                    isRejected = true;
                }
            }

            if (!isRejected) {
                processedImages.push(uploadRes.secure_url);
            } else {
                // If rejected, we just skip pushing it to processedImages
            }
          } else {
            // Already a URL (existing image)
            processedImages.push(img);
          }
      }

      // If any were rejected, notify user
      if (processedImages.length < images.length) {
          await redisClient.publish("job-events", JSON.stringify({
             type: "MEDIA_REJECTED",
             userId: userId.toString(),
             mediaType: type,
             reason: "One or more images were rejected due to inappropriate content"
           }));
      }
      
      updateData.gallery = processedImages;
    }

    // Save to DB
    const oldUser = user.toObject();
    
    // Fallback empty check to prevent Mongo invalid empty updates
    if (Object.keys(updateData).length > 0) {
        console.log(`[MediaWorker] Saving to MongoDB for ${userId}. Payload fields:`, Object.keys(updateData));
        await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true }).select("-password");
        console.log(`[MediaWorker] DB Save complete for ${userId}`);
    } else {
        console.warn(`[MediaWorker] Empty updateData for ${userId}, skipping DB save.`);
    }

    // Invalidate Caches
    await Promise.all([
      invalidateUserCache(userId),
      invalidateMatchesCache(userId, "profile_full"),
      invalidateUserCaches(userId),
      dispatchExploreSync(userId, oldUser),
    ]).catch(() => {});

    // Notify via Redis Pub/Sub for real-time UI refresh
    const payloadInfo = {
       type: "MEDIA_PROCESSED",
       userId: userId.toString(),
       mediaType: type,
       payload: updateData
    };
    console.log(`[MediaWorker] Emitting JOB EVENT success for ${userId}:`, payloadInfo);
    
    await redisClient.publish("job-events", JSON.stringify(payloadInfo));

    return { success: true, userId, updatedFields: Object.keys(updateData) };
  } catch (error) {
    console.error(`❌ [MediaWorker] Error:`, error);
    // Don't throw, let BullMQ mark it as failed safely
    // Throwing here might cause an unhandled Rejection if not properly bound
    return Promise.reject(error);
  }
};

const mediaWorker = new Worker("media-queue", workerHandler, {
  connection: bullMQConnection,
  concurrency: 10,
});

mediaWorker.on("failed", (job, err) => {
  console.error(`🚨 [MediaWorker] Job ${job.id} failed: ${err.message}`);
});

console.log("✅ [MediaWorker] Worker Started & Listening...");

export default mediaWorker;
