import express from "express";
import { protect } from "../middleware/auth.js";
import { getExploreMatches, getUserDetails, getUserLocation } from "../controllers/explore/explore.js";



const router = express.Router();

router.get("/location", protect, getUserLocation);
router.get("/explore", protect, getExploreMatches);
router.get("/details/:userId", protect, getUserDetails);


export default router;
