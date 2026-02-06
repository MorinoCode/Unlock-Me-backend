import express from "express";
import {
  createCheckoutSession,
  getSubscriptionPlans,
  cancelSubscription,
  changePlan,
  verifyPaymentAndUpdateSubscription,
} from "../controllers/paymentController/paymentController.js";

import { protect, optionalProtect } from "../middleware/auth.js";

const router = express.Router();

// دریافت پلن‌ها؛ اگر کاربر لاگین باشد ارز بر اساس کشور او انتخاب می‌شود، وگرنه از query.currency استفاده می‌شود
router.get("/plans", optionalProtect, getSubscriptionPlans);

// روت قبلی: ساخت لینک پرداخت (حتماً باید لاگین باشد)
router.post("/create-session", protect, createCheckoutSession);

// Cancel subscription
router.post("/cancel", protect, cancelSubscription);

// Change plan
router.post("/change-plan", protect, changePlan);

// Verify payment and update subscription (fallback if webhook fails)
router.post("/verify-session", protect, verifyPaymentAndUpdateSubscription);

export default router;
