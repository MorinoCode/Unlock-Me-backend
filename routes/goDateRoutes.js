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

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

router.post("/create", protect, upload.single("image"), createGoDate);
router.get("/all", protect, getAvailableDates);
router.get("/mine", protect, getMyDates);
router.get("/:dateId", protect, getGoDateDetails);
router.post("/apply", protect, applyForDate);
router.post("/withdraw", protect, withdrawApplication);
router.post("/accept", protect, acceptDateApplicant);
router.post("/:dateId/cancel", protect, cancelGoDate);
router.delete("/:dateId", protect, deleteGoDate);

export default router;
