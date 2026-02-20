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
           
           // 1. Delete from Cloudinary (Enforce clean up)
           await cloudinary.uploader.destroy(item.public_id);

           // 2. Find User associated with this image
           // Profile Avatar & Gallery images are stored with specific path patterns
           // Avatar usually: unlock_me_avatars/[random_id]
           // Gallery: unlock_me_gallery/[random_id]
           
           // Strategy: Search User who has this string in their avatar or gallery
           // We search for the *full URL* match part because DB has full URL. 
           // Cloudinary public_id "unlock_me_avatars/xyz" matches URL ".../unlock_me_avatars/xyz.jpg"
           
           // NOTE: public_id does not have extension. DB URL has extension. 
           // Regex match: url contains public_id
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

               // Check Avatar
               if (user.avatar && user.avatar.includes(item.public_id)) {
                   updateData.avatar = "https://res.cloudinary.com/dsm2vj701/image/upload/v1700000000/default-avatar.png"; // Fallback to default
                   notifyUser = true;
               }

               // Check Gallery
               if (user.gallery && user.gallery.some(img => img.includes(item.public_id))) {
                   updateData.gallery = user.gallery.filter(img => !img.includes(item.public_id));
                   notifyUser = true;
               }

               if (notifyUser) {
                   await User.findByIdAndUpdate(user._id, { $set: updateData });
                   
                   // Real-time Notification
                   await redisClient.publish("job-events", JSON.stringify({
                        type: "MEDIA_REJECTED",
                        userId: user._id.toString(),
                        reason: "Image was rejected by automated moderation.",
                        notes: "Your image has been removed for violating community guidelines."
                   }));
                   console.log(`[Webhook] ✅ User ${user._id} cleaned and notified.`);
               }
           } else {
               console.warn(`[Webhook] ⚠️ No user found for public_id: ${item.public_id}`);
           }
       } else {
           console.log(`[Webhook] ✅ Image approved: ${item.public_id}`);
       }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("[Webhook] Error:", error);
    res.status(500).send("Webhook processing failed");
  }
};
