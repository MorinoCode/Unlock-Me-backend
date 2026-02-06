import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getBlindDateStatus,
  getActiveSession,
  recordBlindDateUsage,
  submitAnswer,
  sendStageMessage,
  proceedToNextStage,
  handleRevealDecision,
} from "../controllers/blindDateController/blindDateController.js";

const router = express.Router();

// --- Status & Usage ---
router.get("/status", protect, getBlindDateStatus);
router.get("/active-session", protect, getActiveSession);
router.post("/record-usage", protect, recordBlindDateUsage);

// --- Game Logic ---
router.post("/answer", protect, submitAnswer);
router.post("/message", protect, sendStageMessage);
router.post("/proceed", protect, proceedToNextStage);
router.post("/reveal-decision", protect, handleRevealDecision);

export default router;
