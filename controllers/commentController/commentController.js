import Comment from '../../models/Comment.js';
import Post from '../../models/Post.js';
import User from '../../models/User.js';

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    const userId = await User.findById(req.user.userId).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (!content || content.trim() === "") {
      return res.status(400).json({ message: "Comment content is required" });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const newComment = new Comment({
      content,
      author: userId,
      post: postId
    });

    const savedComment = await newComment.save();

    // پاپولیت کردن نویسنده برای نمایش بلافاصله در فرانت‌اِند
    const populatedComment = await Comment.findById(savedComment._id)
      .populate('author', 'name avatar');

    res.status(201).json(populatedComment);
  } catch (error) {
    console.error("Add Comment Error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const comments = await Comment.find({ post: postId })
      .sort({ createdAt: 1 }) // قدیمی به جدید
      .populate('author', 'name avatar');
    
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};