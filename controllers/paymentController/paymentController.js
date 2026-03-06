/**
 * paymentController.js
 * 
 * ✅ Stripe REMOVED. All purchases are handled via RevenueCat (Apple/Google IAP).
 * - /api/payment/plans  → static plan list for UI display
 * - /api/payment/cancel → DB-only cancel (user keeps access until expiresAt)
 * - /api/payment/revenuecat-webhook → RevenueCat webhook (source of truth)
 * - /api/payment/change-plan → redirects user to manage in App Store/Google Play
 */

import User from "../../models/User.js";
import { invalidateMatchesCache } from "../../utils/cacheHelper.js";
import { addToRevenueCatQueue } from "../../queues/revenueCatQueue.js";

// ─────────────────────────────────────────────────────────────────
// STATIC PLAN DEFINITIONS (prices shown for UI only)
// Real billing is handled by RevenueCat in the App Store / Google Play
// ─────────────────────────────────────────────────────────────────
const STATIC_PLANS = {
  sek: [
    { id: "gold_sek",     productName: "Gold Plan",     amount: 99,  currency: "sek", interval: "month" },
    { id: "platinum_sek", productName: "Platinum Plan", amount: 149, currency: "sek", interval: "month" },
    { id: "diamond_sek",  productName: "Diamond Plan",  amount: 199, currency: "sek", interval: "month" },
  ],
  usd: [
    { id: "gold_usd",     productName: "Gold Plan",     amount: 9,   currency: "usd", interval: "month" },
    { id: "platinum_usd", productName: "Platinum Plan", amount: 14,  currency: "usd", interval: "month" },
    { id: "diamond_usd",  productName: "Diamond Plan",  amount: 19,  currency: "usd", interval: "month" },
  ],
  eur: [
    { id: "gold_eur",     productName: "Gold Plan",     amount: 9,   currency: "eur", interval: "month" },
    { id: "platinum_eur", productName: "Platinum Plan", amount: 13,  currency: "eur", interval: "month" },
    { id: "diamond_eur",  productName: "Diamond Plan",  amount: 18,  currency: "eur", interval: "month" },
  ],
  gbp: [
    { id: "gold_gbp",     productName: "Gold Plan",     amount: 8,   currency: "gbp", interval: "month" },
    { id: "platinum_gbp", productName: "Platinum Plan", amount: 12,  currency: "gbp", interval: "month" },
    { id: "diamond_gbp",  productName: "Diamond Plan",  amount: 16,  currency: "gbp", interval: "month" },
  ],
  nok: [
    { id: "gold_nok",     productName: "Gold Plan",     amount: 99,  currency: "nok", interval: "month" },
    { id: "platinum_nok", productName: "Platinum Plan", amount: 149, currency: "nok", interval: "month" },
    { id: "diamond_nok",  productName: "Diamond Plan",  amount: 199, currency: "nok", interval: "month" },
  ],
  dkk: [
    { id: "gold_dkk",     productName: "Gold Plan",     amount: 69,  currency: "dkk", interval: "month" },
    { id: "platinum_dkk", productName: "Platinum Plan", amount: 99,  currency: "dkk", interval: "month" },
    { id: "diamond_dkk",  productName: "Diamond Plan",  amount: 139, currency: "dkk", interval: "month" },
  ],
  inr: [
    { id: "gold_inr",     productName: "Gold Plan",     amount: 749, currency: "inr", interval: "month" },
    { id: "platinum_inr", productName: "Platinum Plan", amount: 1099,currency: "inr", interval: "month" },
    { id: "diamond_inr",  productName: "Diamond Plan",  amount: 1499,currency: "inr", interval: "month" },
  ],
};

const COUNTRY_TO_CURRENCY = {
  SE: "sek", SV: "usd", US: "usd", GB: "gbp",
  CA: "usd", AU: "usd", NZ: "usd",
  DE: "eur", FR: "eur", IT: "eur", ES: "eur",
  NL: "eur", AT: "eur", BE: "eur", FI: "eur",
  IE: "eur", PT: "eur",
  NO: "nok", DK: "dkk",
  IN: "inr",
};

function getCurrencyFromCountry(country) {
  if (!country || typeof country !== "string") return null;
  return COUNTRY_TO_CURRENCY[country.trim().toUpperCase().slice(0, 2)] || null;
}

// ─────────────────────────────────────────────────────────────────
// 1. GET /api/payment/plans  — static plan list for UI
// ─────────────────────────────────────────────────────────────────
export const getSubscriptionPlans = async (req, res) => {
  try {
    const requestedCurrency = (req.query.currency || "").toLowerCase().trim();

    let currency = requestedCurrency || null;
    if (!currency && req.user) {
      const userId = req.user._id ?? req.user.userId;
      if (userId) {
        const user = await User.findById(userId).select("location").lean();
        currency = getCurrencyFromCountry(user?.location?.country);
      }
    }
    currency = currency || "usd";

    const plans = STATIC_PLANS[currency] ?? STATIC_PLANS["usd"];
    return res.status(200).json(plans);
  } catch (err) {
    console.error("[Plans] Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ─────────────────────────────────────────────────────────────────
// 2. POST /api/payment/cancel  — DB-only cancel, no Stripe
// ─────────────────────────────────────────────────────────────────
export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.subscription?.status !== "active" || user.subscription?.plan === "free") {
      return res.status(400).json({ message: "No active subscription to cancel" });
    }

    // ✅ DB-only cancel: user keeps access until expiresAt (no Stripe call)
    await User.findByIdAndUpdate(userId, {
      $set: { "subscription.status": "canceled" }
    });

    // Invalidate cache
    await invalidateMatchesCache(userId.toString(), "profile").catch(() => {});

    console.log(`[Cancel] User ${userId} canceled subscription (plan kept until ${user.subscription.expiresAt})`);

    return res.status(200).json({
      message: "Subscription canceled. You keep access until the end of your billing period.",
      subscription: {
        plan: user.subscription.plan,
        status: "canceled",
        expiresAt: user.subscription.expiresAt,
      },
    });
  } catch (err) {
    console.error("[Cancel] Error:", err);
    return res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Server error" : err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// 3. POST /api/payment/change-plan  — redirect to App Store/Play
// ─────────────────────────────────────────────────────────────────
export const changePlan = async (req, res) => {
  return res.status(200).json({
    success: false,
    redirectToApp: true,
    message: "To change your plan, open the Unlock Me app on your iPhone or Android device and manage your subscription from the App Store or Google Play.",
  });
};

// ─────────────────────────────────────────────────────────────────
// 4. POST /api/payment/revenuecat-webhook  — RevenueCat → DB sync
//    Called by RevenueCat when: purchase, renewal, cancellation, expiry
// ─────────────────────────────────────────────────────────────────
export const revenueCatWebhook = async (req, res) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (secret) {
      let incomingSecret = req.headers["authorization"] || req.headers["x-revenuecat-secret"];
      
      // Clean "Bearer " prefix if present in header
      if (incomingSecret && incomingSecret.toLowerCase().startsWith("bearer ")) {
        incomingSecret = incomingSecret.slice(7);
      }

      if (incomingSecret !== secret && process.env.NODE_ENV === "production") {
        console.warn("[RevenueCat Webhook] ❌ Invalid secret");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    // RevenueCat usually sends { event: { ... } } or just the event itself.
    // We normalize it here.
    const event = req.body.event || req.body;
    
    if (!event || !event.id || !event.type) {
        console.warn("[RevenueCat Webhook] ❌ Missing or malformed event payload");
        return res.status(400).json({ error: "Malformed event" });
    }

    // ✅ Fast Response: Push to BullMQ background processor
    await addToRevenueCatQueue({ event });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[RevenueCat Webhook] Error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};

// ─────────────────────────────────────────────────────────────────
// Deprecated: left as stub to avoid 404s if still called
// ─────────────────────────────────────────────────────────────────
export const createCheckoutSession = async (_req, res) => {
  return res.status(410).json({
    error: "Web checkout is no longer supported. Please use the Unlock Me mobile app.",
  });
};

export const verifyPaymentAndUpdateSubscription = async (_req, res) => {
  return res.status(410).json({
    error: "Web payments are no longer supported. Subscriptions are managed via RevenueCat.",
  });
};
