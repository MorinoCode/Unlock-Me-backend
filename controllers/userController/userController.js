import User from "../../models/User.js";
import bcrypt from "bcryptjs";
import cloudinary from "../../config/cloudinary.js"; 
import { Resend } from "resend"; 
import crypto from "crypto";
import { getPasswordResetTemplate } from "../../templates/emailTemplates.js";
import { calculateUserDNA } from "../../utils/matchUtils.js";
import Conversation from "../../models/Conversation.js"
import Message from "../../models/Message.js";
import Post from "../../models/Post.js"

const resend = new Resend(process.env.RESEND_API_KEY);

// --- تابع کمکی برای پاک کردن فایل از Cloudinary ---
// این تابع URL فایل را می‌گیرد و آن را از سرورهای کلودینری حذف می‌کند
const deleteFromCloudinary = async (url) => {
  if (!url) return;
  
  try {
    // استخراج Public ID از URL
    // مثال URL: https://res.cloudinary.com/.../unlock_me_gallery/abc12345.jpg
    // ما نیاز داریم به: unlock_me_gallery/abc12345
    
    const regex = /\/([^/]+)\/([^/]+)\.[^.]+$/; // گرفتن نام پوشه و نام فایل
    const match = url.match(regex);
    
    if (match) {
      const folder = match[1];
      const filename = match[2];
      const publicId = `${folder}/${filename}`;
      
      // تشخیص نوع فایل (ویس یا عکس)
      const resourceType = url.includes("/video/") ? "video" : "image";

      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      console.log(`Deleted from Cloudinary: ${publicId}`);
    }
  } catch (error) {
    console.error("Error deleting file from Cloudinary:", error);
  }
};

// --- دریافت اطلاعات کاربر دیگر (Public) ---
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

// --- دریافت اطلاعات خود کاربر (Private) ---
export const getUserInformation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "name username dna avatar bio location gallery gender lookingFor subscription birthday interests questionsbycategoriesResults voiceIntro likedBy likedUsers dislikedUsers superLikedUsers"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};

// --- آپدیت پروفایل (شامل آواتار و ویس) ---
export const updateProfileInfo = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    // یافتن کاربر فعلی برای دسترسی به اطلاعات قدیمی (جهت حذف)
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

    // ۱. مدیریت آواتار
    if (avatar && avatar.startsWith("data:image")) {
      // اگر آواتار جدید است، آواتار قبلی را پاک کن (اگر دیفالت نباشد)
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
        console.log(err);
        return res.status(500).json({ message: "Avatar upload failed" });
      }
    } else if (avatar) {
      updateData.avatar = avatar;
    }

    // ۲. مدیریت ویس (Voice Intro) - اصلاح شده برای حذف و جایگزینی
    if (voiceIntro && voiceIntro.startsWith("data:audio")) {
      // اگر ویس جدید است، ویس قبلی را پاک کن
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
      // اگر کاربر دکمه حذف ویس را زده باشد
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

// --- تغییر رمز عبور ---
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

// --- آپدیت گالری (حذف عکس‌های پاک شده + آپلود عکس‌های جدید) ---
export const updateGallery = async (req, res) => {
  try {
    const { images } = req.body; // این آرایه‌ی جدید است که از فرانت می‌آید
    const userId = req.user.userId || req.user.id;

    if (!Array.isArray(images) || images.length > 6) {
      return res.status(400).json({ message: "Invalid images or limit exceeded" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // الف) پیدا کردن عکس‌های حذف شده
    // هر عکسی که در دیتابیس هست ولی در آرایه جدید (images) نیست، یعنی حذف شده
    const imagesToDelete = user.gallery.filter(oldImg => !images.includes(oldImg));

    // ب) حذف عکس‌های حذف شده از Cloudinary
    for (const imgUrl of imagesToDelete) {
      await deleteFromCloudinary(imgUrl);
    }

    // ج) آپلود عکس‌های جدید (که به صورت Base64 هستند)
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
        // اگر لینک قدیمی است، دست نزن
        return img;
      })
    );

    // د) ذخیره آرایه نهایی در دیتابیس
    user.gallery = processedImages;
    await user.save();

    res.status(200).json(user.gallery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- آپدیت علایق ---
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

    // ذخیره جواب‌ها
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

    // ✅ 2. محاسبه و آپدیت DNA قبل از ذخیره
const newDNA = calculateUserDNA(user, true);   
    user.dna = newDNA;

    await user.save();
    res.status(200).json({ 
        questionsResults: user.questionsbycategoriesResults, 
        dna: newDNA // ارسال DNA جدید به فرانت
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
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
        // Posts are stored in 'unlock_me_posts' folder per your cloudinary.js
        await deleteFromCloudinary(post.image);
      }
    }
    await Post.deleteMany({ author: userId });

    // 4. WIPE MESSAGES & CHATS
    // Adjust collection names if they differ in your project
    try {
      // Delete messages sent or received by user
      
      await Message.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] });

      // Delete chats where user is a participant
      
      await Conversation.deleteMany({ participants: { $in: [userId] } });
    } catch (e) {
      console.log("Chat/Message models not initialized yet, skipping...");
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
    res.clearCookie("unlock-me-token"); // Adjust if your cookie name is different

    res.status(200).json({ message: "Account and all associated data permanently deleted." });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ error: error.message });
  }
};