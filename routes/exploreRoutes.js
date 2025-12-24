// exploreRotes.js
import express from "express";
import {
  getExploreMatches,
  getMatchesDashboard,
  getUserDetails,
} from "../controllers/explore/explore.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// دریافت لیست‌های اکسپلور
router.get("/matches", protect, getExploreMatches);

// دریافت دیتای داشبورد مچ‌ها
router.get("/matches-dashboard", protect, getMatchesDashboard);

// دریافت جزئیات یک یوزر خاص
router.get("/user/:userId", protect, getUserDetails);



export default router;
