import Comment from "../../models/Comment.js";
import Post from "../../models/Post.js";
import User from "../../models/User.js";
import { emitNotification } from "../../utils/notificationHelper.js";
import { getMatchesCache, setMatchesCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";

const COMMENTS_CACHE_TTL = 300; // 5 min

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parentCommentId } = req.body;
    const io = req.app.get("io");

    const user = await User.findById(req.user.userId).select("-password");
    if (!user)
      return res.status(401).json({ message: "User not authenticated" });

    if (!content || content.trim() === "") {
      return res.status(400).json({ message: "Comment content is required" });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const newComment = new Comment({
      content: content.trim(),
      author: user._id,
      post: postId,
      ...(parentCommentId && { parentComment: parentCommentId }),
    });

    const savedComment = await newComment.save();

    // ✅ UPDATE: Increment comment count in Post model
    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    const populatedComment = await Comment.findById(savedComment._id)
      .populate("author", "name avatar")
      .populate({
        path: "parentComment",
        select: "author",
        populate: { path: "author", select: "name" },
      });

    if (post.author.toString() !== user._id.toString()) {
      await emitNotification(io, post.author, {
        type: "NEW_COMMENT",
        senderId: user._id,
        senderName: user.name,
        senderAvatar: user.avatar,
        message: `commented: "${content.substring(0, 30)}..."`,
        targetId: postId,
      });
    }

    await invalidateMatchesCache("global", `post_comments_${postId}`).catch(() => {});

    res.status(201).json({
      ...populatedComment.toObject(),
      newPostCommentCount: post.commentCount,
    });
  } catch (error) {
    console.error("Add Comment Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const cached = await getMatchesCache("global", `post_comments_${postId}`);
    if (cached) return res.status(200).json(cached);

    const comments = await Comment.find({ post: postId })
      .sort({ createdAt: 1 })
      .populate("author", "name avatar")
      .populate({
        path: "parentComment",
        select: "author",
        populate: { path: "author", select: "name" },
      })
      .lean();
    await setMatchesCache("global", `post_comments_${postId}`, comments, COMMENTS_CACHE_TTL);
    res.status(200).json(comments);
  } catch (error) {
    console.error("Get Post Comments Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;

    const comment = await Comment.findById(commentId).populate("post");

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isCommentAuthor = comment.author.toString() === userId.toString();
    const isPostOwner = comment.post.author.toString() === userId.toString();

    if (!isCommentAuthor && !isPostOwner) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this comment" });
    }

    const postId = comment.post._id;
    const updated = await Post.findByIdAndUpdate(
      postId,
      { $inc: { commentCount: -1 } },
      { new: true }
    );
    const newCount = Math.max(0, updated?.commentCount ?? 0);

    await comment.deleteOne();
    await invalidateMatchesCache("global", `post_comments_${postId}`).catch(() => {});

    res
      .status(200)
      .json({
        message: "Comment deleted successfully",
        newPostCommentCount: newCount,
      });
  } catch (error) {
    console.error("Delete Comment Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
