import express from "express";
import { protect } from "../middleware/auth.js";
import {
  saveBirthday,
  saveInterests,
  saveAvatar,
  getInterests,
  getUserInterestCategories,
  QuestionsByCategory,
  saveUserInterestCategoriesQuestinsAnswer,
  saveLocation,
  saveBio,
  triggerMatchCalculation,
  checkMatchStatus,
} from "../controllers/onboarding/onboardingController.js";
import multer from "multer";

const router = express.Router();

// Multipart handler for avatar upload
const upload = multer({ storage: multer.memoryStorage() });

// لاگ اولین نقطه رسیدن درخواست به این روت
router.get("/interests-options", (req, res, next) => {
  console.log("[interests-options] 0/6 ROUTE hit", new Date().toISOString());
  next();
}, protect, getInterests);
router.get("/get-user-interests", protect, getUserInterestCategories);
router.post("/questions-by-category", protect, QuestionsByCategory);
router.post("/saveUserInterestCategoriesQuestinsAnswer",protect,saveUserInterestCategoriesQuestinsAnswer);
router.post("/birthday", protect, saveBirthday);
router.post("/interests", protect, saveInterests);
router.post("/avatar", protect, upload.single("avatar"), saveAvatar);
router.post("/location", protect, saveLocation);
router.post("/bio", protect, saveBio);

router.post("/trigger-match-calculation", protect, triggerMatchCalculation);
router.get("/match-status", protect, checkMatchStatus);

export default router;
