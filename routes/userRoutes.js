import express from "express";
import { protect } from "../middleware/auth.js";
import {
  saveBirthday,
  saveInterests,
  saveAvatar,getInterests,getUserInterestCategories
} from "../controllers/onboarding/onboardingController.js";
import multer from "multer";

const router = express.Router();

// Multipart handler for avatar upload
const upload = multer({ storage: multer.memoryStorage() });

router.get("/interests-options", protect, getInterests);
router.get("/getuserineterestcategories", protect, getUserInterestCategories);


router.post("/birthday", protect, saveBirthday);
router.post("/interests", protect, saveInterests);
router.post("/avatar", protect, upload.single("avatar"), saveAvatar);

export default router;
