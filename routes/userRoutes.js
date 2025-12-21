import express from "express";
import { protect } from "../middleware/auth.js";
import { getExploreMatches, getUserLocation } from "../controllers/explore/explore.js";



const router = express.Router();

router.get("/location", protect, getUserLocation);

router.get("/explore", protect, getExploreMatches);


export default router;
