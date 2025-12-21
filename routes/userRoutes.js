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
} from "../controllers/onboarding/onboardingController.js";
import multer from "multer";

const router = express.Router();

// Multipart handler for avatar upload
const upload = multer({ storage: multer.memoryStorage() });

router.get("/interests-options", protect, getInterests);
router.get("/get-user-interests", protect, getUserInterestCategories);
router.post("/questions-by-category", protect, QuestionsByCategory);
router.post(
  "/saveUserInterestCategoriesQuestinsAnswer",
  protect,
  saveUserInterestCategoriesQuestinsAnswer
);

router.post("/birthday", protect, saveBirthday);
router.post("/interests", protect, saveInterests);
router.post("/avatar", protect, upload.single("avatar"), saveAvatar);
router.post("/location", protect, saveLocation);
router.post("/bio", protect, saveBio);

export default router;
