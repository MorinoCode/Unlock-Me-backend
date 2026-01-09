import express from "express";
import { 
    sendMessage, 
    getMessages, 
    getConversations, 
    markAsRead, 
    editMessage, 
    deleteMessage, 
    reactToMessage,
    acceptRequest, // ✅ اضافه شد
    rejectRequest  // ✅ اضافه شد
} from "../controllers/chatController/chatController.js";
import { protect } from "../middleware/auth.js"; 
import { generateIcebreakers } from "../controllers/chatController/aiWingmanController.js";

const router = express.Router();

router.post("/send", protect, sendMessage);
router.get("/conversations", protect, getConversations);

// ✅ روت‌های جدید برای مدیریت ریکوئست‌ها
router.post("/accept", protect, acceptRequest);
router.post("/reject", protect, rejectRequest);

router.get("/:otherUserId", protect, getMessages);
router.put("/read/:otherUserId", protect, markAsRead);
router.put("/edit/:id", protect, editMessage);
router.delete("/delete/:id", protect, deleteMessage);
router.post("/react/:id", protect, reactToMessage);
router.post("/spark", protect, generateIcebreakers);

export default router;