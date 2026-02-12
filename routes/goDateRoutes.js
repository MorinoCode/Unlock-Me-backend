import express from "express";
import { protect } from "../middleware/auth.js";
import multer from "multer";
import {
  createGoDate,
  getAvailableDates,
  getMyDates,
  getGoDateDetails,
  applyForDate,
  withdrawApplication,
  acceptDateApplicant,
  cancelGoDate,
  deleteGoDate,
} from "../controllers/goDateController/goDateController.js";

import { redisRateLimiter } from "../middleware/redisLimiter.js";

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

// 1 create per hour (to prevent spam)
const createLimiter = redisRateLimiter("godate:create", 2, 3600);
// 10 applies per hour
const applyLimiter = redisRateLimiter("godate:apply", 10, 3600);

router.post("/create", protect, createLimiter, upload.single("image"), createGoDate);
router.get("/all", protect, getAvailableDates);
router.get("/mine", protect, getMyDates);
router.get("/:dateId", protect, getGoDateDetails);
router.post("/apply", protect, applyLimiter, applyForDate);
router.post("/withdraw", protect, withdrawApplication);
router.post("/accept", protect, protect, acceptDateApplicant);
router.post("/:dateId/cancel", protect, cancelGoDate);
router.delete("/:dateId", protect, deleteGoDate);

export default router;
