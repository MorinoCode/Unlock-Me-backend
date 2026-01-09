import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import cloudinary from "../../config/cloudinary.js"; 
import { Resend } from "resend"; 
import crypto from "crypto";
import { getPasswordResetTemplate } from "../../templates/emailTemplates.js";
import { calculateUserDNA } from "../../utils/matchUtils.js";
import Conversation from "../../models/Conversation.js";
import Message from "../../models/Message.js";
import Post from "../../models/Post.js";
import { getMatchListLimit } from "../../utils/matchUtils.js";


const resend = new Resend(process.env.RESEND_API_KEY);

// --- Helper: Delete file from Cloudinary ---
// Extracts public ID from URL including folder name
const deleteFromCloudinary = async (url) => {
  if (!url) return;
  
  try {
    // Example URL: https://res.cloudinary.com/cloudname/image/upload/v164000/folder_name/filename.jpg
    // We need: folder_name/filename
    
    // Split the URL by segments
    const parts = url.split('/');
    const filenameWithExt = parts.pop();
    const folder = parts.pop(); // Assumes the folder is immediately before the filename
    const filename = filenameWithExt.split('.')[0];
    
    // Construct Public ID
    const publicId = `${folder}/${filename}`;
    
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
    const user = await User.findById(req.params.userId).select(
      "name username email avatar bio location phone detailedAddress gallery gender lookingFor questionsbycategoriesResults subscription birthday voiceIntro"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};

// --- Get Current User Info (Private) ---
export const getUserInformation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "name username dna avatar bio location gallery gender lookingFor subscription birthday interests questionsbycategoriesResults voiceIntro likedBy likedUsers dislikedUsers superLikedUsers superLikedBy usage"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
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
    } = req.body;

    const updateData = {
      name, bio, phone,
      location: { country, city, countryCode },
      gender, lookingFor, birthday,
    };

    // 1. Handle Avatar
    if (avatar && avatar.startsWith("data:image")) {
      // Delete old avatar if it's not the default
      if (currentUser.avatar && !currentUser.avatar.includes("default-avatar")) {
         await deleteFromCloudinary(currentUser.avatar);
      }

      try {
        const uploadRes = await cloudinary.uploader.upload(avatar, {
          folder: "unlock_me_avatars",
          transformation: [{ width: 500, height: 500, crop: "fill" }],
        });
        updateData.avatar = uploadRes.secure_url;
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Avatar upload failed" });
      }
    } else if (avatar) {
      updateData.avatar = avatar;
    }

    // 2. Handle Voice Intro
    if (voiceIntro && voiceIntro.startsWith("data:audio")) {
      // Delete old voice if exists
      if (currentUser.voiceIntro) {
        await deleteFromCloudinary(currentUser.voiceIntro);
      }

      try {
        const uploadRes = await cloudinary.uploader.upload(voiceIntro, {
          resource_type: "video",
          folder: "unlock_me_voices",
          public_id: `voice_${userId}_${Date.now()}`,
          overwrite: true,
        });
        updateData.voiceIntro = uploadRes.secure_url;
      } catch (err) {
        console.error("Voice upload error:", err);
        return res.status(500).json({ message: "Voice upload failed" });
      }
    } else if (voiceIntro === "") {
      // User explicitly removed voice
      if (currentUser.voiceIntro) {
        await deleteFromCloudinary(currentUser.voiceIntro);
      }
      updateData.voiceIntro = "";
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: error.message });
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

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    // A) Identify deleted images
    // Any image in DB not present in new 'images' array is considered deleted
    const imagesToDelete = user.gallery.filter(oldImg => !images.includes(oldImg));

    // B) Remove deleted images from Cloudinary
    for (const imgUrl of imagesToDelete) {
      await deleteFromCloudinary(imgUrl);
    }

    // C) Upload new images (Base64)
    const processedImages = await Promise.all(
      images.map(async (img) => {
        if (img.startsWith("data:image")) {
          try {
            const uploadRes = await cloudinary.uploader.upload(img, {
              folder: "unlock_me_gallery",
              transformation: [{ width: 800, crop: "limit" }]
            });
            return uploadRes.secure_url;
          } catch (err) {
            console.error("Gallery upload error:", err);
            throw new Error("Failed to upload gallery image");
          }
        }
        // If it's an existing URL, keep it
        return img;
      })
    );

    // D) Save final array
    user.gallery = processedImages;
    await user.save();

    res.status(200).json(user.gallery);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(200).json({ 
        questionsResults: user.questionsbycategoriesResults, 
        dna: newDNA 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// --- Forgot Password ---
export const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    
    email = email.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const tempPassword = crypto.randomBytes(4).toString("hex");

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(tempPassword, salt);
    await user.save();

    const { data, error } = await resend.emails.send({
      from: "UnlockMe Support <noreply@unlock-me.app>", 
      to: [email],
      subject: "Your New Password - UnlockMe",
      html: getPasswordResetTemplate(user.name , tempPassword),
    });
    
    if(data){
      return res.status(200).json({ message : "Please check your email"})
    }

    if (error) {
      console.error("Resend Error:", error);
      return res.status(500).json({ message: "Error sending email", error });
    }

    res.status(200).json({ message: "New password sent to your email." });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: error.message });
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
      for (const imgUrl of user.gallery) {
        await deleteFromCloudinary(imgUrl);
      }
    }

    // 3. WIPE POSTS & POST IMAGES
    const userPosts = await Post.find({ author: userId });
    for (const post of userPosts) {
      if (post.image) {
        // Posts are stored in 'unlock_me_posts' folder or similar
        await deleteFromCloudinary(post.image);
      }
    }
    await Post.deleteMany({ author: userId });

    // 4. WIPE MESSAGES & CHATS
    try {
      // Delete messages sent or received by user
      await Message.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] });

      // Delete chats where user is a participant
      await Conversation.deleteMany({ participants: { $in: [userId] } });
    } catch (e) {
      console.log("Chat/Message cleanup error or models missing:", e);
    }

    // 5. REMOVE USER FROM OTHER USERS' LISTS (Likes/Matches)
    await User.updateMany(
      {},
      {
        $pull: {
          likedUsers: userId,
          likedBy: userId,
          dislikedUsers: userId,
          superLikedUsers: userId,
          superLikedBy: userId,
          "potentialMatches": { user: userId }
        }
      }
    );

    // 6. DELETE THE USER RECORD
    await User.findByIdAndDelete(userId);

    // 7. CLEAR SESSION/COOKIE
    res.clearCookie("unlock-me-token"); 

    res.status(200).json({ message: "Account and all associated data permanently deleted." });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- Matches Dashboard (Updated Logic) ---
export const getMatchesDashboard = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const me = await User.findById(currentUserId)
        .select("likedUsers superLikedUsers likedBy superLikedBy subscription matches");
        console.log(me);

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
    
    const mutualMatches = await User.find({ _id: { $in: mutualIds } })
        .select(populateFields)
        .lean();
        console.log(mutualMatches);

    // --- B. SENT LIKES ---
    // (کسانی که من لایک کردم)
    const sentIds = [...(me.likedUsers || []), ...(me.superLikedUsers || [])];
    const sentLikes = await User.find({ _id: { $in: sentIds } })
        .select(populateFields)
        .lean();

    // --- C. INCOMING LIKES (The Important Part!) ---
    // (کسانی که من را لایک کردند اما من هنوز لایک نکردم)
    const incomingIds = [...(me.likedBy || []), ...(me.superLikedBy || [])].filter(
        id => !mutualIds.includes(id.toString()) // حذف کسانی که مچ شده‌اند
    );

    const rawIncoming = await User.find({ _id: { $in: incomingIds } })
        .select(populateFields)
        .lean();

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
    res.status(500).json({ message: "Server error" });
  }
};