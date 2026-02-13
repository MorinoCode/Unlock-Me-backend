import express from "express";
import {
  createPost,
  deletePost,
  getCountryFeed,
  getMyPosts,
  toggleLikePost,
  updatePost,
} from "../controllers/postController/postController.js";
import {
  addComment,
  deleteComment,
  getPostComments,
  toggleLikeComment,
} from "../controllers/commentController/commentController.js";
import { protect } from "../middleware/auth.js";
import { upload } from "../config/cloudinary.js";
import { redisRateLimiter } from "../middleware/redisLimiter.js";
import { checkFeatureFlag } from "../middleware/featureFlagMiddleware.js";

const router = express.Router();

// Rate limiters
const postCreateLimiter = redisRateLimiter("post:create", 5, 3600); // 5 posts per hour
const postLikeLimiter = redisRateLimiter("post:like", 100, 3600); // 100 likes per hour
const postCommentLimiter = redisRateLimiter("post:comment", 30, 3600); // 30 comments per hour

router.post("/create", protect, checkFeatureFlag("ENABLE_FEED_API"), postCreateLimiter, upload.single("image"), createPost);
router.get("/feed", protect, checkFeatureFlag("ENABLE_FEED_API"), getCountryFeed);
router.post("/:postId/like", protect, checkFeatureFlag("ENABLE_FEED_API"), postLikeLimiter, toggleLikePost);
router.post("/:postId/comments", protect, checkFeatureFlag("ENABLE_FEED_API"), postCommentLimiter, addComment);
router.get("/:postId/comments", protect, checkFeatureFlag("ENABLE_FEED_API"), getPostComments);
router.delete("/comments/:commentId", protect, checkFeatureFlag("ENABLE_FEED_API"), deleteComment);
router.post("/comments/:commentId/like", protect, checkFeatureFlag("ENABLE_FEED_API"), postLikeLimiter, toggleLikeComment);
router.get("/my-posts", protect, getMyPosts);
router.put("/:postId", protect, upload.single("image"), updatePost);
router.delete("/:postId", protect, deletePost);

export default router;
