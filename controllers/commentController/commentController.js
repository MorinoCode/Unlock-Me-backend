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

export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;
    console.log(userId);

    const comment = await Comment.findById(commentId).populate('post');

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    // بررسی دسترسی: نویسنده کامنت یا صاحب پست
    const isCommentAuthor = comment.author.toString() === userId.toString();
    const isPostOwner = comment.post.author.toString() === userId.toString();

    if (!isCommentAuthor && !isPostOwner) {
      return res.status(403).json({ message: "Not authorized to delete this comment" });
    }

    await comment.deleteOne();
    res.status(200).json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Delete Comment Error:", error);
    res.status(500).json({ message: error.message });
  }
};