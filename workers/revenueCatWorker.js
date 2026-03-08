import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import PaymentLog from "../models/PaymentLog.js";
import User from "../models/User.js";
import { invalidateMatchesCache, invalidateUserCache } from "../utils/cacheHelper.js";

const processRevenueCatWebhook = async (job) => {
  const { event } = job.data;
  const { 
    id, 
    type, 
    app_user_id, 
    product_id, 
    expiration_at_ms, 
    purchased_at_ms, 
    entitlement_ids,
    store,
    environment
  } = event;

  console.log(`[RevenueCat Worker] Processing event ${id} (${type}) for User ${app_user_id}`);

  // Idempotency Check
  const existingLog = await PaymentLog.findOne({ eventId: id });
  if (existingLog) {
    if (existingLog.status === "processed") {
      console.log(`[RevenueCat Worker] Event ${id} already processed. Skipping.`);
      return;
    }
  } else {
    // Create new pending log if not exists
    await PaymentLog.create({
      eventId: id,
      appUserId: app_user_id,
      eventType: type,
      productId: product_id,
      entitlementIds: entitlement_ids || [],
      store: store,
      environment: environment,
      status: "pending",
      purchasedAtMs: purchased_at_ms ? Number(purchased_at_ms) : null,
      expirationAtMs: expiration_at_ms ? Number(expiration_at_ms) : null,
    });
  }

  try {
    const isTestEvent = type === "TEST";
    if (isTestEvent) {
      console.log(`[RevenueCat Worker] ✅ Test event ${id} received and acknowledged.`);
      await PaymentLog.findOneAndUpdate({ eventId: id }, { $set: { status: "processed" } });
      return;
    }

    if (!app_user_id) {
       throw new Error(`Event ${id} has no app_user_id`);
    }

    // Safe MongoDB Query: Prevent CastError if app_user_id is not a valid ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(app_user_id);
    
    let user;
    if (isObjectId) {
      user = await User.findById(app_user_id);
    }
    
    if (!user) {
      // Try searching by revenueCatId if not found by primary ID
      user = await User.findOne({ "subscription.revenueCatId": app_user_id });
    }

    if (!user) {
      console.warn(`[RevenueCat Worker] User ${app_user_id} not found. Skipping.`);
      await PaymentLog.findOneAndUpdate({ eventId: id }, { $set: { status: "skipped", errorLog: "User not found" } });
      return;
    }

    const productLower = (product_id || "").toLowerCase();
    let plan = "free";
    if (productLower.includes("diamond")) plan = "diamond";
    else if (productLower.includes("platinum")) plan = "platinum";
    else if (productLower.includes("gold")) plan = "gold";

    const expiresAt = expiration_at_ms ? new Date(Number(expiration_at_ms)) : null;
    const startedAt = purchased_at_ms ? new Date(Number(purchased_at_ms)) : null;

    let update = {};

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
      case "NON_RENEWING_PURCHASE":
        update = {
          "subscription.plan": plan,
          "subscription.status": "active",
          "subscription.expiresAt": expiresAt,
          "subscription.startedAt": startedAt || user.subscription?.startedAt || new Date(),
          "subscription.isTrial": false,
          "subscription.trialExpiresAt": null,
        };
        break;

      case "TRIAL_STARTED":
        update = {
          "subscription.plan": plan,
          "subscription.status": "active",
          "subscription.expiresAt": expiresAt,
          "subscription.startedAt": startedAt || new Date(),
          "subscription.isTrial": true,
        };
        break;

      case "CANCELLATION":
      case "SUBSCRIBER_ALIAS":
        update = {
          "subscription.status": "canceled",
          "subscription.expiresAt": expiresAt,
        };
        break;

      case "EXPIRATION":
      case "SUBSCRIBER_REFUND":
      case "BILLING_ISSUE":
        update = {
          "subscription.plan": "free",
          "subscription.status": "expired",
          "subscription.expiresAt": null,
          "subscription.startedAt": null,
          "subscription.isTrial": false,
        };
        break;

      default:
        console.log(`[RevenueCat Worker] Ignoring unhandled event: ${type}`);
        break;
    }

    if (Object.keys(update).length > 0) {
      await User.findByIdAndUpdate(app_user_id, { $set: update });
      await Promise.all([
        invalidateMatchesCache(app_user_id, "profile").catch(() => {}),
        invalidateUserCache(app_user_id).catch(() => {})
      ]);
    }

    // Mark log as successfully processed
    await PaymentLog.findOneAndUpdate({ eventId: id }, { $set: { status: "processed" } });
    console.log(`[RevenueCat Worker] Event ${id} completed successfully.`);

  } catch (error) {
    // Record failure in the PaymentLog structure
    await PaymentLog.findOneAndUpdate(
      { eventId: id }, 
      { $set: { status: "failed", errorLog: error.message } }
    );
    throw error; // Let BullMQ retry
  }
};

const revenueCatWorker = new Worker(
  "revenuecat-webhook-queue",
  processRevenueCatWebhook,
  {
    connection: bullMQConnection,
    concurrency: 5, // Process up to 5 webhooks concurrently
  }
);

revenueCatWorker.on("completed", (job) => {
  console.log(`[RevenueCat Worker] Job ${job.id} has completed!`);
});

revenueCatWorker.on("failed", (job, err) => {
  console.error(`[RevenueCat Worker] Job ${job.id} has failed with ${err.message}`);
});

export default revenueCatWorker;
