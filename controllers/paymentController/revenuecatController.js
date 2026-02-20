import User from "../../models/User.js";
import { invalidateUserCache, invalidateMatchesCache } from "../../utils/cacheHelper.js";

// Optional: Map RevenueCat Product IDs or Entitlements to your internal plan names
const mapEntitlementToPlan = (entitlements) => {
  // Replace these strings with your actual RevenueCat Entitlement Identifiers
  if (entitlements.includes("diamond")) return "diamond";
  if (entitlements.includes("platinum")) return "platinum";
  if (entitlements.includes("gold")) return "gold";
  return "free";
};

// --- CLIENT VERIFICATION ---
// @desc    Verify and Sync Subscription from Mobile App
// @route   POST /api/payment/revenuecat/verify
// @access  Private (Mobile App calls this after purchase)
export const verifySubscription = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    // Mobile app sends exactly what RevenueCat SDK returned for "customerInfo"
    const { originalAppUserId, activeEntitlements } = req.body; 

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Update user based on the active entitlements array sent by the app
    const newPlan = mapEntitlementToPlan(activeEntitlements);

    user.subscription = {
      ...user.subscription,
      plan: newPlan,
      status: activeEntitlements.length > 0 ? "active" : "expired",
      revenueCatId: originalAppUserId || user.subscription.revenueCatId,
      activeEntitlements,
      // If the plan changed, update the startedAt
      startedAt: user.subscription.plan !== newPlan ? new Date() : user.subscription.startedAt
    };

    await user.save();

    // Force flush cache so Explore/Matches apply the new plan immediately
    await Promise.all([
      invalidateUserCache(userId),
      invalidateMatchesCache(userId, "profile_full")
    ]).catch(err => console.error("Cache invalidation error:", err));

    res.status(200).json({ 
      success: true, 
      message: "Subscription synced successfully", 
      subscription: user.subscription 
    });
  } catch (error) {
    console.error("RevenueCat Verification Error:", error);
    res.status(500).json({ message: "Failed to verify subscription" });
  }
};


// --- SERVER-TO-SERVER WEBHOOK ---
// @desc    Receive Lifecycle Events directly from RevenueCat
// @route   POST /api/payment/revenuecat/webhook
// @access  Public (Secured by Authorization Header)
export const handleRevenueCatWebhook = async (req, res) => {
  try {
    // 1. Verify Authentication (Configure this secret in your RevenueCat Dashboard)
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_SECRET || "changeme_in_production";
    const authHeader = req.headers.authorization;

    if (authHeader !== `Bearer ${expectedAuth}` && authHeader !== expectedAuth && process.env.NODE_ENV === "production") {
       console.warn("⚠️ Unauthorized RevenueCat Webhook Attempt");
       return res.status(401).json({ message: "Unauthorized" });
    }

    const { event } = req.body;
    if (!event) return res.status(400).json({ message: "Mising event payload" });

    const revenueCatId = event.app_user_id; // This should match our database
    const eventType = event.type; // e.g. INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION

    console.log(`📡 [RevenueCat Webhook] Event: ${eventType} for User: ${revenueCatId}`);

    // Assuming we previously set user.subscription.revenueCatId = app_user_id
    // Alternatively, if app_user_id is the user's Mongo ID, query by _id.
    const user = await User.findOne({ 
      $or: [
        { "subscription.revenueCatId": revenueCatId },
        { _id: revenueCatId } // If your app sends the mongo DB ID as the RevenueCat app_user_id
      ]
    });

    if (!user) {
      console.warn(`[RevenueCat] User not found for app_user_id: ${revenueCatId}`);
      return res.status(200).json({ message: "User not found, but webhook received" }); 
      // Return 200 so RevenueCat doesn't keep retrying
    }

    // Determine the user's actual current active entitlements from the event
    // The event payload contains an 'entitlement_ids' array of what the user literally bought
    const activeEntitlements = event.entitlement_ids || [];
    const newPlan = mapEntitlementToPlan(activeEntitlements);

    // Apply the changes to the user based on event type
    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION":
      case "TRANSFER":
        user.subscription.status = "active";
        user.subscription.plan = newPlan !== "free" ? newPlan : user.subscription.plan;
        user.subscription.expiresAt = event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)) : null;
        user.subscription.activeEntitlements = activeEntitlements;
        break;

      case "CANCELLATION":
        // Usually, cancellation means auto-renew is off, but they still have access until expiresAt.
        // We log it, but status remains 'active' until the 'EXPIRATION' event fires.
        break;

      case "EXPIRATION":
      case "BILLING_ISSUE":
        // The subscription actually lapsed
        user.subscription.status = "expired";
        user.subscription.plan = "free";
        user.subscription.activeEntitlements = [];
        break;
        
      default:
        console.log(`[RevenueCat] Unhandled event type: ${eventType}`);
    }

    // Optionally create a Transaction log for Admin Panel here
    // await Transaction.create({ userId: user._id, type: eventType, platform: event.store, ... })

    await user.save();

    // Flush cache so UI updates immediately if they are actively using the app
    await Promise.all([
      invalidateUserCache(user._id),
      invalidateMatchesCache(user._id, "profile_full")
    ]).catch(err => console.error("Cache invalidation error:", err));

    res.status(200).json({ success: true, message: "Webhook processed" });

  } catch (error) {
    console.error("RevenueCat Webhook Error:", error);
    res.status(500).json({ message: "Webhook failed" });
  }
};
