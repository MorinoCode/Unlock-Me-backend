import Post from "../../models/Post.js";
import {
  getMatchesCache,
  setMatchesCache,
  invalidateMatchesCache,
} from "../../utils/cacheHelper.js";
import cloudinary from "../../config/cloudinary.js"; // وارد کردن تنطیمات کلودیناری

const POSTS_MY_CACHE_TTL = 180; // 3 min
// ✅ ایجاد پست جدید
export const createPost = async (req, res) => {
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
    await invalidateMatchesCache(req.user.userId, "posts_my");

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
    const cacheKey = `posts:${userCountry}:${page}:${limit}`;
    const cached = await getMatchesCache(
      req.user.userId,
      `posts_${userCountry}_${page}`
    );
    if (cached) {
      return res.status(200).json(cached);
    }

    const currentUserId = req.user.userId;
    const posts = await Post.find({
      country: userCountry,
      author: { $ne: currentUserId },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "name avatar country")
      .lean();

    const totalPosts = await Post.countDocuments({
      country: userCountry,
      author: { $ne: currentUserId },
    });
    const hasMore = page * limit < totalPosts;

    const result = {
      posts,
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

    // تبدیل آیدی کاربر به رشته برای مقایسه امن
    const userIdStr = userId.toString();

    // ✅ Critical Fix: Null check to prevent crash
    const isLiked = (post.likes || []).some(
      (id) => id?.toString() === userIdStr
    );

    if (isLiked) {
      // عملیات آنلایک: حذف از آرایه
      post.likes = (post.likes || []).filter(
        (id) => id && id.toString() !== userIdStr
      );
    } else {
      // عملیات لایک: اضافه کردن به آرایه
      post.likes.push(userId);
    }

    await post.save();

    // بازگرداندن آرایه جدید لایک‌ها به فرانت‌اِند
    res.status(200).json(post.likes);
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
export const getMyPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const cached = await getMatchesCache(userId, "posts_my");
    if (cached) return res.status(200).json(cached);

    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .populate("author", "name avatar")
      .lean();

    await setMatchesCache(userId, "posts_my", posts, POSTS_MY_CACHE_TTL);
    res.status(200).json(posts);
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

    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ message: "Description is required" });
      }
      post.description = description.trim().slice(0, 2200);
    }

    await post.save();
    await invalidateMatchesCache(currentUserId, "posts_my");
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
    await invalidateMatchesCache(currentUserId, "posts_my");

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
