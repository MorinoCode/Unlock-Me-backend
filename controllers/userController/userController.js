import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import cloudinary from "../../config/cloudinary.js"; 
import { Resend } from "resend"; 
import crypto from "crypto";
import { getPasswordResetTemplate } from "../../templates/emailTemplates.js";
import { calculateUserDNA, calculateCompatibility } from "../../utils/matchUtils.js";
import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import Post from "../../models/Post.js";
import GoDate from "../../models/GoDate.js";
import GoDateApply from "../../models/GoDateApply.js";
import { getMatchListLimit } from "../../utils/matchUtils.js";
import { getMatchesCache, setMatchesCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";
import { mediaQueue } from "../../config/queue.js";

const resend = new Resend(process.env.RESEND_API_KEY);
const PROFILE_FULL_TTL = 300; // 5 min

// --- Helper: Delete file from Cloudinary ---
// Extracts public ID from URL including folder name
const deleteFromCloudinary = async (url) => {
  if (!url) return;
  
  try {
    // ✅ Improvement #21: Robust URL parsing using regex
    // Extracts public ID from URLs like:
    //   https://res.cloudinary.com/cloud/image/upload/v123/folder/file.jpg
    //   https://res.cloudinary.com/cloud/video/upload/v123/folder/sub/file.webm
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    if (!match || !match[1]) {
      console.warn(`Could not extract public ID from URL: ${url}`);
      return;
    }
    const publicId = match[1];
    
    // Determine resource type
    const resourceType = url.includes("/video/") ? "video" : "image";

    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    console.log(`Deleted from Cloudinary: ${publicId}`);
  } catch (error) {
    console.error("Error deleting file from Cloudinary:", error);
  }
};

// --- Get Public User Info ---
export const getUserById = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.user?.userId?.toString?.() || req.user?.id?.toString?.();

    if (currentUserId && requestedUserId === currentUserId) {
      const cached = await getMatchesCache(currentUserId, "profile_full");
      if (cached) return res.status(200).json(cached);
    }

    const user = await User.findById(req.params.userId).select(
      "name username email avatar bio location phone detailedAddress gallery gender lookingFor questionsbycategoriesResults subscription birthday voiceIntro verification"
    ).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    if (currentUserId && requestedUserId === currentUserId) {
      await setMatchesCache(currentUserId, "profile_full", user, PROFILE_FULL_TTL);
    }

    // ✅ NEW: Calculate Match Score if viewing another user
    let matchScore = null;
    if (currentUserId && requestedUserId !== currentUserId) {
      const currentUser = await User.findById(currentUserId).select(
        "location lookingFor dna birthday interests gender questionsbycategoriesResults"
      ).lean();

      if (currentUser) {
        matchScore = calculateCompatibility(currentUser, user);
      }
    }

    res.status(200).json({ ...user, matchScore });
  } catch (error) {
    console.error("Get User By ID Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

// --- Get Current User Info (Private) ---
export const getUserInformation = async (req, res) => {
  try {
    if (!req.user) return res.status(200).json(null);

    const user = await User.findById(req.user.userId || req.user.id).select(
      "name username dna avatar bio location gallery gender lookingFor subscription birthday interests questionsbycategoriesResults voiceIntro verification likedBy likedUsers dislikedUsers superLikedUsers superLikedBy blockedUsers blockedBy usage potentialMatches lastMatchCalculation"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("Get User Information Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

// --- Update Profile (Avatar & Voice) ---
export const updateProfileInfo = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    // Find current user to access old data for deletion
    const currentUser = await User.findById(userId);
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    const {
      name, bio, phone, country, city, countryCode,
      gender, lookingFor, birthday, avatar, voiceIntro,
      location,
    } = req.body;

    const updateData = {
      name, bio, phone,
      gender, lookingFor, birthday,
    };

    // Handle location update - preserve existing coordinates and type if not provided
    if (country !== undefined || city !== undefined || countryCode !== undefined || location) {
      const locationUpdate = {
        type: (location && location.type) ? location.type : (currentUser.location?.type || "Point"),
        coordinates: (location && location.coordinates && Array.isArray(location.coordinates) && location.coordinates.length === 2) 
          ? location.coordinates 
          : (currentUser.location?.coordinates && Array.isArray(currentUser.location.coordinates) && currentUser.location.coordinates.length === 2)
            ? currentUser.location.coordinates
            : [0, 0],
        country: country !== undefined ? country : (currentUser.location?.country || ""),
        city: city !== undefined ? city : (currentUser.location?.city || ""),
      };
      
      updateData.location = locationUpdate;
    }

    // 1. Handle Avatar (ASYNC)
    if (avatar && avatar.startsWith("data:image")) {
      await mediaQueue.add("UPLOAD_AVATAR", {
        type: "UPLOAD_AVATAR",
        userId: userId.toString(),
        data: { avatarBase64: avatar }
      });
      // We don't update avatar here, the worker will do it.
    } else if (avatar) {
      updateData.avatar = avatar;
    }

    // 2. Handle Voice Intro (ASYNC)
    if (voiceIntro && typeof voiceIntro === "string" && voiceIntro.startsWith("data:audio")) {
      await mediaQueue.add("UPLOAD_VOICE", {
        type: "UPLOAD_VOICE",
        userId: userId.toString(),
        data: { voiceBase64: voiceIntro }
      });
      // We don't update voiceIntro here, the worker will do it.
    } else if (voiceIntro === "") {
      // User explicitly removed voice
      if (currentUser.voiceIntro) {
        await deleteFromCloudinary(currentUser.voiceIntro);
      }
      updateData.voiceIntro = "";
    } else if (voiceIntro && typeof voiceIntro === "string" && !voiceIntro.startsWith("data:")) {
      updateData.voiceIntro = voiceIntro;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    // ✅ Invalidate caches so Explore/unlock and my profile show fresh data
    const { invalidateUserCache, invalidateExploreCache } = await import("../../utils/cacheHelper.js");
    const { invalidateMatchesCache } = await import("../../utils/cacheHelper.js");
    const { invalidateUserCaches } = await import("../../utils/redisMatchHelper.js");
    const { dispatchExploreSync } = await import("../../utils/workerDispatcher.js");

    await Promise.all([
      invalidateUserCache(userId),
      invalidateExploreCache(userId),
      invalidateMatchesCache(userId, "profile_full"),
      invalidateUserCaches(userId),
      // ✅ Trigger Redis Index Update (Background)
      dispatchExploreSync(userId, currentUser.toObject()), 
    ]).catch((err) => console.error("Cache/Sync error:", err));

    const isProcessing = (avatar && avatar.startsWith("data:image")) || (voiceIntro && voiceIntro.startsWith("data:audio"));

    res.status(200).json({
      user: updatedUser,
      status: isProcessing ? "processing" : "completed",
      message: isProcessing ? "Profile data updated. Media is processing in background." : "Profile updated successfully"
    });
  } catch (error) {
    console.error("Update profile error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// --- Update Password ---
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId || req.user.id;

    const user = await User.findById(userId);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Current password incorrect" });

    // ✅ Security Fix: Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ 
        message: "Password must contain uppercase, lowercase, number and special character" 
      });
    }
    
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    
    const { invalidateUserCache } = await import("../../utils/cacheHelper.js");
    await Promise.all([
      invalidateUserCache(userId),
      invalidateMatchesCache(userId, "profile_full"),
    ]).catch((err) => console.error("Cache invalidation error:", err));

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Update Password Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

// --- Update Gallery ---
export const updateGallery = async (req, res) => {
  try {
    const { images } = req.body; // New array from frontend
    const userId = req.user.userId || req.user.id;

    if (!Array.isArray(images) || images.length > 6) {
      return res.status(400).json({ message: "Invalid images or limit exceeded" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Queue Gallery Upload (ASYNC)
    await mediaQueue.add("UPLOAD_GALLERY", {
      type: "UPLOAD_GALLERY",
      userId: userId.toString(),
      data: { images }
    });

    res.status(202).json({ 
        message: "Gallery update started in background.",
        status: "processing"
    });
  } catch (error) {
    console.error("Update Gallery Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

// --- Update Interests / DNA ---
export const updateCategoryAnswers = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { categoryName, answers, quizResults } = req.body; 

    const user = await User.findById(userId);

    if (!user.questionsbycategoriesResults) {
        user.questionsbycategoriesResults = { categories: new Map() };
    }
    if (!user.questionsbycategoriesResults.categories) {
        user.questionsbycategoriesResults.categories = new Map();
    }

    // Save answers
    if (quizResults) {
       const grouped = quizResults.reduce((acc, curr) => {
         if (!acc[curr.category]) acc[curr.category] = [];
         acc[curr.category].push(curr);
         return acc;
       }, {});
       
       for (const [cat, ansList] of Object.entries(grouped)) {
         user.questionsbycategoriesResults.categories.set(cat, ansList);
       }
    } else if (categoryName && answers) {
       user.questionsbycategoriesResults.categories.set(categoryName, answers);
    }

    // Recalculate and update DNA
    const newDNA = calculateUserDNA(user, true);   
    user.dna = newDNA;

    await user.save();
    
    // ✅ Trigger Redis Sync for Interests
    const { dispatchExploreSync } = await import("../../utils/workerDispatcher.js");
    dispatchExploreSync(userId, user.toObject()); // We send current user as old data isn't easily available, or just send current

    invalidateMatchesCache(userId, "profile_full").catch((err) => console.error("Cache invalidation error:", err));
    res.status(200).json({ 
        questionsResults: user.questionsbycategoriesResults, 
        dna: newDNA 
    });
  } catch (error) {
    console.error("Update Category Answers Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// --- Forgot Password ---
export const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    
    email = email.toLowerCase().trim();

    // ✅ Security Fix #11: Always return same response to prevent user enumeration
    const genericMessage = "If this email is registered, you'll receive a password reset email.";

    const user = await User.findOne({ email });
    if (!user) {
      // Return same response whether user exists or not
      return res.status(200).json({ message: genericMessage });
    }

    const tempPassword = crypto.randomBytes(4).toString("hex");

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(tempPassword, salt);
    await user.save();

    const { error } = await resend.emails.send({
      from: "UnlockMe Support <noreply@unlock-me.app>", 
      to: [email],
      subject: "Your New Password - UnlockMe",
      html: getPasswordResetTemplate(user.name , tempPassword),
    });
    
    if (error) {
      console.error("Resend Error:", error);
    }

    res.status(200).json({ message: genericMessage });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// --- Delete Account ---
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    // 1. Find the user to get file URLs
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 2. WIPE CLOUDINARY FILES
    // Delete Avatar
    if (user.avatar && !user.avatar.includes("default-avatar")) {
      await deleteFromCloudinary(user.avatar);
    }

    // Delete Voice Intro
    if (user.voiceIntro) {
      await deleteFromCloudinary(user.voiceIntro);
    }

    // Delete Gallery Images
    if (user.gallery && user.gallery.length > 0) {
      // ✅ Improvement #24: Parallel Cloudinary deletes
      await Promise.all(user.gallery.map(imgUrl => deleteFromCloudinary(imgUrl)));
    }

    // 3. WIPE POSTS & POST IMAGES
    const userPosts = await Post.find({ author: userId });
    // ✅ Improvement #24: Parallel Cloudinary deletes
    await Promise.all(
      userPosts.filter(post => post.image).map(post => deleteFromCloudinary(post.image))
    );
    await Post.deleteMany({ author: userId });

    // 4. WIPE MESSAGES & CHATS (Soft Delete - other user keeps chat history)
    try {
      // ✅ Bug Fix #2: Delete chat file attachments from Cloudinary
      const userMessages = await Message.find({
        sender: userId,
        fileUrl: { $exists: true, $nin: [null, ""] }
      });
      for (const msg of userMessages) {
        if (msg.fileUrl) {
          await deleteFromCloudinary(msg.fileUrl);
        }
      }

      // ✅ Bug Fix #3: Soft delete — anonymize user's messages, don't delete conversation
      // Anonymize messages sent by deleted user (keep them visible for the other user)
      await Message.updateMany(
        { sender: userId },
        { $set: { sender: null, text: "This message is from a deleted account", isDeleted: true } }
      );

      // Delete messages that were ONLY received by the deleted user (cleanup)
      // But keep messages sent TO the deleted user (they belong to the sender's side too)

      // Remove deleted user from conversation participants
      // If both participants are gone, delete the conversation
      const userConversations = await Conversation.find({ participants: userId });
      for (const conv of userConversations) {
        if (conv.participants.length <= 2) {
          // Remove the deleted user from participants
          await Conversation.findByIdAndUpdate(conv._id, {
            $pull: { participants: userId },
            $addToSet: { hiddenBy: userId }
          });
        }
      }

      // Clean up conversations with no remaining participants
      await Conversation.deleteMany({ participants: { $size: 0 } });

    } catch (e) {
      console.log("Chat/Message cleanup error or models missing:", e);
    }

    // 4b. GO DATE CLEANUP (Scale & Stability Fix)
    try {
      // Find dates created by the user to cleanup images
      const userDates = await GoDate.find({ creator: userId });
      for (const date of userDates) {
        if (date.imageId) {
          await cloudinary.uploader.destroy(date.imageId).catch(() => {});
        }
      }
      
      // Delete all dates created by user
      await GoDate.deleteMany({ creator: userId });
      
      // Delete all applications made by user
      await GoDateApply.deleteMany({ userId: userId });
      
      // Remove user from any applicants list of OTHER dates
      await GoDate.updateMany(
        { applicants: userId },
        { $pull: { applicants: userId } }
      );
      
      console.log(`[GoDateCleanup] Cleaned up records for user: ${userId}`);
    } catch (e) {
      console.error("GoDate cleanup error:", e);
    }

    // 5. TARGETED CLEANUP (Scale Optimization)
    // Instead of full collection scan with {}, we target specific users
    const relatedUserIds = [
      ...(user.likedBy || []),
      ...(user.superLikedBy || []),
      ...(user.likedUsers || []),
      ...(user.superLikedUsers || []),
      ...(user.dislikedUsers || []),
      ...(user.matches || []),
      ...(user.blockedBy || []),
      ...(user.blockedUsers || []),
    ].map(id => id.toString());

    // Remove duplicates
    const uniqueTargetIds = [...new Set(relatedUserIds)];

    if (uniqueTargetIds.length > 0) {
      await User.updateMany(
        { _id: { $in: uniqueTargetIds } },
        {
          $pull: {
            likedUsers: userId,
            likedBy: userId,
            dislikedUsers: userId,
            superLikedUsers: userId,
            superLikedBy: userId,
            matches: userId,
            blockedUsers: userId,
            blockedBy: userId,
            potentialMatches: { user: userId }
          }
        }
      );
    }

    // 6. DELETE THE USER RECORD
    await User.findByIdAndDelete(userId);

    // 7. CLEAR SESSION/COOKIES
    res.clearCookie("unlock-me-token"); 
    // ✅ Bug Fix: Also clear the refresh token cookie
    res.clearCookie("unlock-me-refresh-token");

    res.status(200).json({ message: "Account and all associated data permanently deleted." });
  } catch (error) {
    console.error("Delete account error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// --- Matches Dashboard (Updated Logic) ---
export const getMatchesDashboard = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const me = await User.findById(currentUserId)
        .select("likedUsers superLikedUsers likedBy superLikedBy subscription matches blockedUsers blockedBy");

    if (!me) return res.status(404).json({ message: "User not found" });

    // 1. Get Plan & Limits
    const userPlan = me.subscription?.plan || "free";
    // محدودیت تعداد برای Incoming (کسانی که من را لایک کردند)
    const incomingLimit = getMatchListLimit(userPlan, 'incoming'); 
    
    // 2. Helper to populate user details
    // فقط فیلدهای ضروری را می‌گیریم
    const populateFields = "name avatar matchScore isVerified birthday location"; 

    // --- A. MUTUAL MATCHES ---
    // (کسانی که هم من لایک کردم هم آنها من را)
    // برای مچ‌های دوطرفه معمولاً محدودیتی نیست یا خیلی بالاست
    const mutualIds = me.matches || []; // فرض بر این است که مچ‌ها در فیلد matches ذخیره می‌شوند
    // اگر فیلد matches نداری، باید محاسبه کنی:
    // const mutualIds = me.likedUsers.filter(id => me.likedBy.includes(id));
    
    // ✅ Bug Fix: Build blocked set for filtering
    const blockedSet = new Set([
      ...(me.blockedUsers || []).map(id => id.toString()),
      ...(me.blockedBy || []).map(id => id.toString()),
    ]);

    const mutualMatches = (await User.find({ _id: { $in: mutualIds } })
        .select(populateFields)
        .lean()).filter(u => !blockedSet.has(u._id.toString()));

    // --- B. SENT LIKES ---
    // (کسانی که من لایک کردم)
    const sentIds = [...(me.likedUsers || []), ...(me.superLikedUsers || [])];
    const sentLikes = (await User.find({ _id: { $in: sentIds } })
        .select(populateFields)
        .lean()).filter(u => !blockedSet.has(u._id.toString()));

    // --- C. INCOMING LIKES (The Important Part!) ---
    // (کسانی که من را لایک کردند اما من هنوز لایک نکردم)
    const incomingIds = [...(me.likedBy || []), ...(me.superLikedBy || [])].filter(
        id => !mutualIds.includes(id.toString()) // حذف کسانی که مچ شده‌اند
    );

    const rawIncoming = (await User.find({ _id: { $in: incomingIds } })
        .select(populateFields)
        .lean()).filter(u => !blockedSet.has(u._id.toString()));

    // ✅ اعمال محدودیت روی Incoming Likes
    // اگر لیمیت بی‌نهایت بود (گلد/پلاتینیوم) -> همه را نشان بده
    // اگر لیمیت 0 بود (رایگان) -> همه را قفل کن
    // اگر لیمیت عدد بود -> تعداد مشخصی باز، بقیه قفل
    
    const processedIncoming = rawIncoming.map((user, index) => {
        let isLocked = false;

        if (incomingLimit === Infinity) {
            isLocked = false;
        } else if (incomingLimit === 0) {
            isLocked = true; // همه قفل برای کاربر رایگان
        } else {
            // مثلاً لیمیت ۵ است، ۵ تای اول باز، بقیه قفل
            isLocked = index >= incomingLimit;
        }

        // اگر قفل بود، اسم و آواتار را مخدوش کن (اختیاری، ولی isLocked: true کافیست)
        return {
            ...user,
            isLocked: isLocked,
            // اگر خیلی محکم‌کاری می‌خواهی، وقتی قفل است آواتار نفرست:
            // avatar: isLocked ? null : user.avatar 
        };
    });

    res.status(200).json({
        mutualMatches,
        sentLikes,
        incomingLikes: processedIncoming, // لیست پردازش شده
        userPlan
    });

  } catch (error) {
    console.error("Dashboard Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
