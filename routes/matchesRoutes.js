import express from "express";
import { protect } from "../middleware/auth.js";
import { getMatchesDashboard, getMatchInsights } from "../controllers/matches/matches.js";

const router = express.Router();

router.get("/matches-dashboard", protect, getMatchesDashboard);
router.get("/insights/:targetUserId", protect, getMatchInsights);

export default router;