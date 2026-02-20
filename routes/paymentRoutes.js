import express from "express";
import {
  createCheckoutSession,
  getSubscriptionPlans,
  cancelSubscription,
  changePlan,
  verifyPaymentAndUpdateSubscription,
  revenueCatWebhook,
} from "../controllers/paymentController/paymentController.js";

import { verifySubscription } from "../controllers/paymentController/revenuecatController.js";

import { protect, optionalProtect } from "../middleware/auth.js";

const router = express.Router();

// ✅ Static plan list for UI display (no Stripe)
router.get("/plans", optionalProtect, getSubscriptionPlans);

// ✅ RevenueCat webhook — called by RevenueCat on purchase/renewal/cancel/expiry
// NO auth middleware — RevenueCat sends its own secret header
router.post("/revenuecat-webhook", revenueCatWebhook);

// ✅ Cancel subscription (DB-only, no Stripe)
router.post("/cancel", protect, cancelSubscription);

// ✅ Change plan — redirects user to App Store / Google Play
router.post("/change-plan", protect, changePlan);

// ✅ Verify Native Mobile Subscription via RevenueCat
router.post("/revenuecat/verify", protect, verifySubscription);

// ─── Deprecated stubs (return 410 Gone) ─────────────────────────
router.post("/create-session", protect, createCheckoutSession);
router.post("/verify-session", protect, verifyPaymentAndUpdateSubscription);

export default router;
