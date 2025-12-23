import express from "express";
import { getExploreMatches } from "../controllers/explore/explore.js"; 
import { protect } from "../middleware/auth.js"; 

const router = express.Router();

router.get("/matches", protect, getExploreMatches);

export default router;