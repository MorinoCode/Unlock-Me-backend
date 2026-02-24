import User from "../../models/User.js";
import cloudinary from "../../config/cloudinary.js";
import redisClient from "../../config/redis.js";

export const handleCloudinaryWebhook = async (req, res) => {
  try {
    const { notification_type, moderation_status, public_id, resources } = req.body;

    // We are only interested in moderation events
    if (notification_type !== "moderation") {
      return res.status(200).send("Ignored");
    }

    // Handle single resource or list of resources
    const items = resources || [{ public_id, moderation_status }];

    for (const item of items) {
       if (item.moderation_status === "rejected") {
           console.log(`[Webhook] 🚨 Image REJECTED by AI: ${item.public_id}`);
           
           // 1. Delete from Cloudinary
           await cloudinary.uploader.destroy(item.public_id);

           // 2. Find user by URL match (DB stores full URL, public_id has no extension)
           const regex = new RegExp(item.public_id);
           const user = await User.findOne({
               $or: [
                   { avatar: { $regex: regex } },
                   { gallery: { $regex: regex } }
               ]
           });

           if (user) {
               console.log(`[Webhook] 👤 Found user ${user._id} for rejected image.`);
               
               let notifyUser = false;
               let updateData = {};
               let mediaType = "UPLOAD_GALLERY";

               // Check Avatar
                if (user.avatar && user.avatar.includes(item.public_id)) {
                   updateData.avatar = ""; // Reset to empty — frontend shows local defaultAvatar
                   notifyUser = true;
                   mediaType = "UPLOAD_AVATAR";
               }

               // Check Gallery
               if (user.gallery && user.gallery.some(img => img.includes(item.public_id))) {
                   updateData.gallery = user.gallery.filter(img => !img.includes(item.public_id));
                   notifyUser = true;
               }

               if (notifyUser) {
                   await User.findByIdAndUpdate(user._id, { $set: updateData });
                   
                   // Invalidate caches so frontend gets fresh data on next checkAuth
                   const { invalidateUserCache, invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
                   await Promise.all([
                     invalidateUserCache(user._id),
                     invalidateMatchesCache(user._id, "profile_full")
                   ]).catch(() => {});

                   // Real-time Notification to frontend
                   await redisClient.publish("job-events", JSON.stringify({
                        type: "MEDIA_REJECTED",
                        userId: user._id.toString(),
                        mediaType,
                        reason: "Image was rejected by automated moderation.",
                        notes: "Your image has been removed for violating community guidelines."
                   }));
                   console.log(`[Webhook] ✅ User ${user._id} cleaned and notified.`);
               }
           } else {
               console.warn(`[Webhook] ⚠️ No user found for public_id: ${item.public_id}`);
           }
       } else if (item.moderation_status === "approved") {
           // ✅ NEW: Notify frontend of approval so it shows success toast & refreshes avatar
           console.log(`[Webhook] ✅ Image APPROVED by AWS: ${item.public_id}`);

           const regex = new RegExp(item.public_id);
           const user = await User.findOne({
               $or: [
                   { avatar: { $regex: regex } },
                   { gallery: { $regex: regex } }
               ]
           });

           if (user) {
               const isAvatar = user.avatar && user.avatar.includes(item.public_id);
               const mediaType = isAvatar ? "UPLOAD_AVATAR" : "UPLOAD_GALLERY";
               
               console.log(`[Webhook] 🎉 Emitting MEDIA_PROCESSED for user ${user._id} (${mediaType})`);

               // Invalidate caches so checkAuth() returns fresh data with the new avatar
               const { invalidateUserCache, invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
               await Promise.all([
                 invalidateUserCache(user._id),
                 invalidateMatchesCache(user._id, "profile_full")
               ]).catch(() => {});

               // Emit success to frontend — this triggers the toast in SocketProvider
               await redisClient.publish("job-events", JSON.stringify({
                   type: "MEDIA_PROCESSED",
                   userId: user._id.toString(),
                   mediaType,
                   payload: {}
               }));
           }
       } else {
           // "pending" or other statuses — do nothing, wait for next webhook call
           console.log(`[Webhook] ⏳ Moderation pending for: ${item.public_id}`);
       }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("[Webhook] Error:", error);
    res.status(500).send("Webhook processing failed");
  }
};
