import Comment from '../../models/Comment.js';
import Post from '../../models/Post.js';
import User from '../../models/User.js';
import { emitNotification } from '../../utils/notificationHelper.js';

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    const io = req.app.get("io");
    
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
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
      author: user._id,
      post: postId
    });

    const savedComment = await newComment.save();

    // Populate author for immediate UI display
    const populatedComment = await Comment.findById(savedComment._id)
      .populate('author', 'name avatar');

    // Notify post author about the new comment
    if (post.author.toString() !== user._id.toString()) {
      emitNotification(io, post.author, {
        type: "NEW_COMMENT",
        senderName: user.name,
        senderAvatar: user.avatar,
        message: `commented: "${content.substring(0, 30)}..."`,
        targetId: postId // Clicking leads to the post
      });
    }

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
      .sort({ createdAt: 1 }) 
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

    const comment = await Comment.findById(commentId).populate('post');

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

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