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
} from "../controllers/commentController/commentController.js";
import { protect } from "../middleware/auth.js";
import { upload } from "../config/cloudinary.js";

const router = express.Router();

router.post("/create", protect, upload.single("image"), createPost);
router.get("/feed", protect, getCountryFeed);
router.post("/:postId/like", protect, toggleLikePost);
router.post("/:postId/comments", protect, addComment);
router.get("/:postId/comments", protect, getPostComments);
router.delete("/comments/:commentId", protect, deleteComment);
router.get("/my-posts", protect, getMyPosts);
router.put("/:postId", protect, updatePost);
router.delete("/:postId", protect, deletePost);

export default router;
