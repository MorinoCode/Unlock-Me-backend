import User from "../../models/User.js";
import { v2 as cloudinary } from "cloudinary";

// --- USER ACTIONS ---
// @desc    Request Liveness Selfie Verification
// @route   POST /api/user/verification/request
// @access  Private
export const requestVerification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Verification video is required" });
    }

    cloudinary.uploader.upload_stream(
      { 
        resource_type: "video", 
        folder: "verifications",
        moderation: "aws_rekognition_video_moderation", // ✅ Scale Optimization: AI video moderation
        // ✅ Scale Optimization: Force compression to save bandwidth and storage
        transformation: [
          { width: 720, crop: "limit" },
          { quality: "auto", fetch_format: "mp4" }
        ]
      },
      async (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return res.status(500).json({ message: "Error uploading verification video" });
        }

        user.verification = {
          status: "pending",
          mediaUrl: result.secure_url,
          publicId: result.public_id,
          requestedAt: new Date()
        };

        await user.save();
        
        // ✅ Invalidate caches so frontend receives the updated `pending` status
        const { invalidateUserCache, invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
        await Promise.all([
          invalidateUserCache(userId),
          invalidateMatchesCache(userId, "profile_full")
        ]).catch(err => console.error("Cache invalidation error:", err));
        
        // Return status 200 after storing
        res.status(200).json({ 
          message: "Verification request submitted successfully",
          status: user.verification.status
        });
      }
    ).end(req.file.buffer);

  } catch (error) {
    console.error("requestVerification Error:", error);
    res.status(500).json({ message: "Server error during verification request" });
  }
};


// --- ADMIN ACTIONS ---
// @desc    Get all pending verifications
// @route   GET /api/admin/verifications/pending
// @access  Private (Admin)
export const getPendingVerifications = async (req, res) => {
  try {
    const users = await User.find({ "verification.status": "pending" })
                            .select("name email avatar gallery verification");
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error("getPendingVerifications Error:", error);
    res.status(500).json({ success: false, message: "Server error fetching verifications" });
  }
};

// @desc    Approve a user verification
// @route   POST /api/admin/verifications/:userId/approve
// @access  Private (Admin)
export const approveVerification = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    
    // Delete video from Cloudinary to save space
    if (user.verification && user.verification.publicId) {
       await cloudinary.uploader.destroy(user.verification.publicId, { resource_type: "video" }).catch(() => {});
    }

    user.verification = {
      status: "verified",
      mediaUrl: null,
      publicId: null,
      requestedAt: null
    };

    await user.save();

    // ✅ Invalidate caches so frontend receives the updated `verified` status
    const { invalidateUserCache, invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
    await Promise.all([
      invalidateUserCache(req.params.userId),
      invalidateMatchesCache(req.params.userId, "profile_full")
    ]).catch(err => console.error("Cache invalidation error:", err));

    res.status(200).json({ success: true, message: "User verified successfully" });
  } catch (error) {
    console.error("approveVerification Error:", error);
    res.status(500).json({ success: false, message: "Server error approving verification" });
  }
};

// @desc    Reject a user verification
// @route   POST /api/admin/verifications/:userId/reject
// @access  Private (Admin)
export const rejectVerification = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Delete video from Cloudinary
    if (user.verification && user.verification.publicId) {
       await cloudinary.uploader.destroy(user.verification.publicId, { resource_type: "video" }).catch(() => {});
    }

    user.verification = {
      status: "rejected",
      mediaUrl: null,
      publicId: null,
      requestedAt: null
    };

    await user.save();
    
    // ✅ Invalidate caches so frontend receives the updated `rejected` status
    const { invalidateUserCache, invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
    await Promise.all([
      invalidateUserCache(req.params.userId),
      invalidateMatchesCache(req.params.userId, "profile_full")
    ]).catch(err => console.error("Cache invalidation error:", err));

    res.status(200).json({ success: true, message: "User verification rejected" });
  } catch (error) {
    console.error("rejectVerification Error:", error);
    res.status(500).json({ success: false, message: "Server error rejecting verification" });
  }
};
