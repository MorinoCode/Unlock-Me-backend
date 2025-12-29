import express from 'express';
import { createPost, deletePost, getCountryFeed, getMyPosts, toggleLikePost } from '../controllers/postController/postController.js';
import { addComment, getPostComments } from '../controllers/commentController/commentController.js';
import { protect } from "../middleware/auth.js";
import { upload } from '../config/cloudinary.js';

const router = express.Router();

router.post('/create', protect, upload.single('image'), createPost);
router.get('/feed', protect, getCountryFeed);
router.post('/:postId/like', protect, toggleLikePost);
router.post('/:postId/comments', protect, addComment);
router.get('/:postId/comments', protect, getPostComments);
router.get('/my-posts', protect, getMyPosts);
router.delete('/:postId', protect, deletePost);

export default router;