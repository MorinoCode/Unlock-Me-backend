// matchesRoutes.js

import express from "express";
import { protect } from "../middleware/auth.js";
import { getMatchesDashboard } from "../controllers/matches/matches.js";

const router = express.Router();



router.get("/matches-dashboard", protect, getMatchesDashboard);




export default router;
