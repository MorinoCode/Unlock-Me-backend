import express from "express";
import { protect } from "../middleware/auth.js";
import {
  saveBirthday,
  saveInterests,
  saveAvatar,getInterests,QuestionsByCategory
} from "../controllers/onboarding/onboardingController.js";
import multer from "multer";

const router = express.Router();

// Multipart handler for avatar upload
const upload = multer({ storage: multer.memoryStorage() });

router.get("/interests-options", protect, getInterests);

router.post("/birthday", protect, saveBirthday);
router.post("/interests", protect, saveInterests);
router.post("/avatar", protect, upload.single("avatar"), saveAvatar);
router.post("/questions-by-category", protect,  QuestionsByCategory);

export default router;
