import Post from "../../models/Post.js";
import User from "../../models/User.js";
import Like from "../../models/Like.js";
import {
  getMatchesCache,
  setMatchesCache,
  invalidateFeedCache,
} from "../../utils/cacheHelper.js";
import cloudinary from "../../config/cloudinary.js"; // وارد کردن تنطیمات کلودیناری

const POSTS_MY_CACHE_TTL = 180; // 3 min
// ✅ ایجاد پست جدید
export const createPost = async (req, res) => {
  console.log("Creating post for user:", req.user?.userId);
  try {
    const { description } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "Image is required" });
    }

    // استفاده از userId که در توکن/میدل‌ور ست شده
    const newPost = new Post({
      author: req.user.userId,
      image: req.file.path,
      description,
      country: req.user.location.country,
    });

    await newPost.save();
    await invalidateFeedCache(req.user.userId);

    // پاپولیت کردن برای اینکه فرانت‌اِند بلافاصله دیتای نویسنده را ببیند
    const populatedPost = await Post.findById(newPost._id).populate(
      "author",
      "name avatar"
    );

    res.status(201).json(populatedPost);
  } catch (error) {
    console.error("Create Post Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

// ✅ دریافت فید بر اساس کشور کاربر
export const getCountryFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const userCountry = req.user.location.country;

    // ✅ Performance Fix: Try cache first
    const cacheKey = `posts_${userCountry}_${page}`;
    const cached = await getMatchesCache(req.user.userId, cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const currentUserId = req.user.userId;

    // ✅ Block filter: exclude posts from blocked users
    const currentUser = await User.findById(currentUserId).select("blockedUsers blockedBy").lean();
    const blockedIds = [
      ...(currentUser?.blockedUsers || []).map(id => id.toString()),
      ...(currentUser?.blockedBy || []).map(id => id.toString()),
    ];

    const posts = await Post.find({
      country: userCountry,
      author: { $ne: currentUserId, $nin: blockedIds },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "name avatar country")
      .lean();

    // ✅ High Scale Fix: Efficiently find which posts the current user has liked
    const postIds = posts.map(p => p._id);
    const userLikes = await Like.find({
      user: currentUserId,
      targetId: { $in: postIds },
      targetType: "Post"
    }).select("targetId").lean();
    
    const likedPostIds = new Set(userLikes.map(l => l.targetId.toString()));
    
    const postsWithLikeInfo = posts.map(p => ({
      ...p,
      isLiked: likedPostIds.has(p._id.toString())
    }));

    const totalPosts = await Post.countDocuments({
      country: userCountry,
      author: { $ne: currentUserId, $nin: blockedIds },
    });
    const hasMore = page * limit < totalPosts;

    const result = {
      posts: postsWithLikeInfo,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    };

    // ✅ Performance Fix: Cache the result
    await setMatchesCache(
      req.user.userId,
      `posts_${userCountry}_${page}`,
      result,
      180
    ); // 3 minutes

    res.status(200).json(result);
  } catch (error) {
    console.error("Get Country Feed Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const toggleLikePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // ✅ مطابق با میدل‌ور protect شما، آیدی در userId ذخیره شده است
    const userId = req.user.userId;
    if (!userId) {
      return res.status(401).json({ message: "User not identified" });
    }

    // ✅ High Scale Fix: Use a separate Like collection instead of an array inside Post
    const existingLike = await Like.findOne({
      user: userId,
      targetId: post._id,
      targetType: "Post",
    });

    let isLiked = false;
    if (existingLike) {
      // Unlike
      await Like.findByIdAndDelete(existingLike._id);
      await Post.findByIdAndUpdate(post._id, { $inc: { likeCount: -1 } });
      isLiked = false;
    } else {
      // Like
      try {
        await Like.create({
          user: userId,
          targetId: post._id,
          targetType: "Post",
        });
        await Post.findByIdAndUpdate(post._id, { $inc: { likeCount: 1 } });
        isLiked = true;
      } catch (err) {
        // Handle race condition if unique index fails
        if (err.code === 11000) {
          return res.status(200).json({ isLiked: true });
        }
        throw err;
      }
    }

    const updatedPost = await Post.findById(post._id).select("likeCount");

    await invalidateFeedCache(userId);

    // ✅ Optimization: Return only necessary data, not the whole likes array
    res.status(200).json({
      isLiked,
      likeCount: Math.max(0, updatedPost.likeCount),
    });
  } catch (error) {
    console.error("Like/Unlike Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
// ✅ دریافت پست‌های من (My Gallery)
// ✅ دریافت پست‌های من (My Gallery)
export const getMyPosts = async (req, res) => {
  const userId = req.user?.userId;
  console.log("Fetching my posts for user:", userId, "page:", req.query.page);
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Cache key needs to include page now
    const cacheKey = `posts_my_${userId}_${page}`;
    const cached = await getMatchesCache(userId, cacheKey);
    if (cached) return res.status(200).json(cached);

    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "name avatar")
      .lean();

    console.log(`Found ${posts.length} posts for user ${userId}`);

    const totalPosts = await Post.countDocuments({ author: userId });
    
    // ✅ High Scale Fix: Efficiently find which posts the current user has liked
    const postIds = posts.map(p => p._id);
    const userLikes = await Like.find({
      user: userId,
      targetId: { $in: postIds },
      targetType: "Post"
    }).select("targetId").lean();
    
    const likedPostIds = new Set(userLikes.map(l => l.targetId.toString()));
    
    const postsWithLikeInfo = posts.map(p => ({
      ...p,
      isLiked: likedPostIds.has(p._id.toString())
    }));

    const hasMore = page * limit < totalPosts;
    const result = {
      posts: postsWithLikeInfo,
      hasMore,
      nextPage: hasMore ? page + 1 : null
    };

    await setMatchesCache(userId, cacheKey, result, POSTS_MY_CACHE_TTL);
    res.status(200).json(result);
  } catch (error) {
    console.error("Get My Posts Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { description } = req.body;
    const currentUserId = req.user.userId;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (post.author.toString() !== currentUserId.toString()) {
      return res
        .status(403)
        .json({ message: "You are not authorized to edit this post" });
    }

    // Update Description
    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ message: "Description is required" });
      }
      post.description = description.trim().slice(0, 2200);
    }

    // Update Image if provided
    if (req.file) {
      // 1. Delete old image from Cloudinary
      if (post.image) {
        try {
          const urlParts = post.image.split("/");
          const fileNameWithExtension = urlParts[urlParts.length - 1];
          const publicIdWithoutExtension = fileNameWithExtension.split(".")[0];
          const fullPublicId = `unlock_me_posts/${publicIdWithoutExtension}`;
          await cloudinary.uploader.destroy(fullPublicId);
        } catch (err) {
          console.error("Failed to delete old image:", err);
        }
      }
      // 2. Set new image path
      post.image = req.file.path;
    }

    await post.save();
    await invalidateFeedCache(currentUserId);
    
    const populated = await Post.findById(post._id).populate(
      "author",
      "name avatar"
    );
    res.status(200).json(populated);
  } catch (error) {
    console.error("Update Post Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    // پیدا کردن پست قبل از حذف برای دسترسی به آدرس عکس
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // بررسی اجازه حذف (فقط صاحب پست)
    const currentUserId = req.user.userId;
    if (post.author.toString() !== currentUserId.toString()) {
      return res
        .status(403)
        .json({ message: "You are not authorized to delete this post" });
    }

    // --- بخش حذف از Cloudinary ---
    if (post.image) {
      try {
        // مطابق تنظیمات شما، فایل‌ها در پوشه 'unlock_me_posts' هستند
        // ما باید Public ID را از انتهای URL استخراج کنیم
        const urlParts = post.image.split("/");
        const fileNameWithExtension = urlParts[urlParts.length - 1]; // مثال: abc123.jpg
        const publicIdWithoutExtension = fileNameWithExtension.split(".")[0]; // مثال: abc123

        // ترکیب نام پوشه و آیدی فایل
        const fullPublicId = `unlock_me_posts/${publicIdWithoutExtension}`;

        const result = await cloudinary.uploader.destroy(fullPublicId);
        console.log("Cloudinary Delete Result:", result);
      } catch (cloudinaryErr) {
        console.error("Cloudinary Deletion Failed:", cloudinaryErr);
        // اگر در حذف از کلودیناری خطایی رخ داد، باز هم اجازه می‌دهیم پست از دیتابیس پاک شود
      }
    }

    // --- حذف از دیتابیس ---
    await post.deleteOne();
    await invalidateFeedCache(currentUserId);

    res
      .status(200)
      .json({ message: "Post and cloud image deleted successfully" });
  } catch (error) {
    console.error("Delete Controller Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
