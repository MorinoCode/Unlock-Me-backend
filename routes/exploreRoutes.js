// exploreRotes.js
import express from "express";
import {
  getExploreMatches,
  getUserDetails,
} from "../controllers/explore/explore.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/matches", protect, getExploreMatches);


router.get("/user/:userId", protect, getUserDetails);



export default router;
