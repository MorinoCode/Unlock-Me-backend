import express from "express";
import {
  sendMessage,
  getMessages,
  getConversations,
  getUnreadMessagesCount,
  markAsRead,
  editMessage,
  deleteMessage,
  reactToMessage,
  acceptRequest,
  rejectRequest,
  hideConversation,
} from "../controllers/chatController/chatController.js";
import { protect } from "../middleware/auth.js";
import { generateIcebreakers } from "../controllers/chatController/aiWingmanController.js";

const router = express.Router();

router.post("/send", protect, sendMessage);
router.get("/conversations", protect, getConversations);
router.get("/unread-count", protect, getUnreadMessagesCount);

router.post("/accept", protect, acceptRequest);
router.post("/reject", protect, rejectRequest);
router.post("/conversations/hide", protect, hideConversation);

router.get("/:otherUserId", protect, getMessages);
router.put("/read/:otherUserId", protect, markAsRead);
router.put("/edit/:id", protect, editMessage);
router.delete("/delete/:id", protect, deleteMessage);
router.post("/react/:id", protect, reactToMessage);
router.post("/spark", protect, generateIcebreakers);

export default router;
