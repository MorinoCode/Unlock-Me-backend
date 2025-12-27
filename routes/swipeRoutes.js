import express from "express";
import { protect } from "../middleware/auth.js";
import { getSwipeCards, handleSwipeAction } from "../controllers/swipe/swipeController.js";

const router = express.Router();

router.get("/cards", protect, getSwipeCards);

router.post("/action", protect, handleSwipeAction);

export default router;