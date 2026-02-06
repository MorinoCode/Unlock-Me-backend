import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notification/notificationController.js";

const router = express.Router();

router.get("/", protect, getNotifications);
router.patch("/mark-read/:id", protect, markAsRead);
router.patch("/mark-all-read", protect, markAllAsRead);

export default router;
