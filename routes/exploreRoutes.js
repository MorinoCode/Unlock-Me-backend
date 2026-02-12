import express from "express";
import {
  getExploreMatches,
  getUserDetails,
  refillExploreSection
} from "../controllers/explore/explore.js";
import { loadMoreSection } from "../controllers/explore/loadMoreSection.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/matches", protect, getExploreMatches);
router.post("/refill", protect, refillExploreSection);
router.post("/loadMore", protect, loadMoreSection);

router.get("/user/:userId", protect, getUserDetails);



export default router;
