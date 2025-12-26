// exploreRotes.js
import express from "express";
import {
  getExploreMatches,
  getMatchesDashboard,
  getUserDetails,
} from "../controllers/explore/explore.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/matches", protect, getExploreMatches);

router.get("/matches-dashboard", protect, getMatchesDashboard);

router.get("/user/:userId", protect, getUserDetails);



export default router;
