import express from "express";
import { sendMessage, getMessages, getConversations, markAsRead, editMessage, deleteMessage, reactToMessage } from "../controllers/chatController/chatController.js";
import { protect } from "../middleware/auth.js"; 

const router = express.Router();

router.post("/send", protect, sendMessage);
router.get("/conversations", protect, getConversations);
router.get("/:otherUserId", protect, getMessages);
router.put("/read/:otherUserId", protect, markAsRead)
router.put("/edit/:id", protect, editMessage);
router.delete("/delete/:id", protect, deleteMessage);
router.post("/react/:id", protect, reactToMessage)

export default router;