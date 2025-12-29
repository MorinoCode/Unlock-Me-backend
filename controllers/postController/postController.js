import Post from "../../models/Post.js";
import cloudinary from '../../config/cloudinary.js'; // وارد کردن تنطیمات کلودیناری
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

    // پاپولیت کردن برای اینکه فرانت‌اِند بلافاصله دیتای نویسنده را ببیند
    const populatedPost = await Post.findById(newPost._id).populate(
      "author",
      "name avatar"
    );

    res.status(201).json(populatedPost);
  } catch (error) {
    console.error("Create Post Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ✅ دریافت فید بر اساس کشور کاربر
export const getCountryFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const userCountry = req.user.location.country;

    const posts = await Post.find({ country: userCountry })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "name avatar country")
      .lean();

    const totalPosts = await Post.countDocuments({ country: userCountry });
    const hasMore = page * limit < totalPosts;

    res.status(200).json({
      posts,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    // ✅ بررسی وجود لایک با استفاده از Optional Chaining برای جلوگیری از کرش
    // id?.toString() باعث می‌شود اگر به هر دلیلی یک آیدی null در دیتابیس باشد، کد ارور ندهد
    const isLiked = post.likes.some((id) => id?.toString() === userIdStr);

    if (isLiked) {
      // عملیات آنلایک: حذف از آرایه
      post.likes = post.likes.filter((id) => id && id.toString() !== userIdStr);
    } else {
      // عملیات لایک: اضافه کردن به آرایه
      post.likes.push(userId);
    }

    await post.save();

    // بازگرداندن آرایه جدید لایک‌ها به فرانت‌اِند
    res.status(200).json(post.likes);
  } catch (error) {
    console.error("Like/Unlike Error:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};
// ✅ دریافت پست‌های من (My Gallery)
export const getMyPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .populate("author", "name avatar")
      .lean();

    res.status(200).json(posts);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching your posts", error: error.message });
  }
};

// ✅ حذف پست (هماهنگ سازی آیدی‌ها)
export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // بررسی اجازه دسترسی (صاحب پست)
    if (post.author.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ message: "Unauthorized to delete this post" });
    }

    // --- بخش حذف از Cloudinary ---
    if (post.image) {
      try {
        // استخراج Public ID از URL
        // مثال URL: https://res.cloudinary.com/demo/image/upload/v1234/folder/image_name.jpg
        // ما بخش folder/image_name را نیاز داریم
        const urlParts = post.image.split('/');
        const fileNameWithExtension = urlParts[urlParts.length - 1]; // image_name.jpg
        const publicIdWithoutExtension = fileNameWithExtension.split('.')[0]; // image_name
        
        // اگر پوشه‌بندی دارید (مثلاً folder/image_name):
        const folderName = urlParts[urlParts.length - 2];
        const fullPublicId = folderName === 'upload' ? publicIdWithoutExtension : `${folderName}/${publicIdWithoutExtension}`;

        await cloudinary.uploader.destroy(fullPublicId);
        console.log("Image deleted from Cloudinary:", fullPublicId);
      } catch (cloudinaryErr) {
        console.error("Cloudinary Delete Error:", cloudinaryErr);
        // حتی اگر از کلودیناری پاک نشد، روند حذف از دیتابیس را ادامه می‌دهی
      }
    }

    // --- حذف از دیتابیس ---
    await post.deleteOne();

    res.status(200).json({ message: "Post and image deleted successfully" });
  } catch (error) {
    console.error("Delete Controller Error:", error);
    res.status(500).json({ message: "Server error during deletion" });
  }
};
