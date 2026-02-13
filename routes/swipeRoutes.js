import express from "express";
import { protect } from "../middleware/auth.js";
import { checkFeatureFlag } from "../middleware/featureFlagMiddleware.js";
// ✅ Scalability Optimization: Use optimized controller with Redis
import {
  getSwipeCards,
  handleSwipeAction,
} from "../controllers/swipe/swipeControllerOptimized.js";

const router = express.Router();

router.get("/cards", protect, checkFeatureFlag("ENABLE_UNLOCK_API"), getSwipeCards);

router.post("/action", protect, checkFeatureFlag("ENABLE_UNLOCK_API"), handleSwipeAction);

export default router;
