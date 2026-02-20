import express from "express";
import { protect } from "../middleware/auth.js";
// import { checkFeatureFlag } from "../middleware/featureFlagMiddleware.js";
// ✅ Scalability Optimization: Use optimized controller with Redis
import {
  getunlockCards,
  handleunlockAction,
} from "../controllers/unlock/unlockControllerOptimized.js";

const router = express.Router();

router.get("/cards", protect, getunlockCards);

router.post("/action", protect, handleunlockAction);

export default router;
