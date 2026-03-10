import logger from "../utils/logger.js";
import { Worker } from "bullmq";
import { bullMQConnection } from "../config/redis.js";
import PaymentLog from "../models/PaymentLog.js";
import User from "../models/User.js";
import { invalidateMatchesCache, invalidateUserCache } from "../utils/cacheHelper.js";
import redisClient from "../config/redis.js";

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
    environment,
    aliases
  } = event;

  logger.info(`[RevenueCat Worker] Processing event ${id} (${type}) for User ${app_user_id}`);

  // Idempotency Check
  const existingLog = await PaymentLog.findOne({ eventId: id });
  if (existingLog) {
    if (existingLog.status === "processed") {
      logger.info(`[RevenueCat Worker] Event ${id} already processed. Skipping.`);
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
      logger.info(`[RevenueCat Worker] ✅ Test event ${id} received and acknowledged.`);
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

    // Identity Merging
    if (!user && aliases && aliases.length > 0) {
      const validMongoIds = aliases.filter(a => /^[0-9a-fA-F]{24}$/.test(a));
      if (validMongoIds.length > 0) {
        user = await User.findOne({ _id: { $in: validMongoIds } });
        if (user) logger.info(`[RevenueCat Worker] Identity Merged successfully for aliases.`);
      }
    }

    if (!user) {
      // It's possible the user is fully anonymous and hasn't logged in yet. 
      // Safe to ignore and just mark as processed.
      logger.warn(`[RevenueCat Worker] User not found for app_user_id: ${app_user_id}. Ignoring.`);
      await PaymentLog.findOneAndUpdate({ eventId: id }, { $set: { status: "processed", errorLog: "User not found (Anonymous)" } });
      return;
    }

    // Determine the plan mapping
    const entitlementsStr = (entitlement_ids || []).join(",").toLowerCase();
    let plan = "free";
    if (entitlementsStr.includes("diamond_access") || entitlementsStr.includes("diamond")) plan = "diamond";
    else if (entitlementsStr.includes("platinum_access") || entitlementsStr.includes("platinum")) plan = "platinum";
    else if (entitlementsStr.includes("gold_access") || entitlementsStr.includes("gold")) plan = "gold";

    const expiresAt = expiration_at_ms ? new Date(Number(expiration_at_ms)) : null;
    const startedAt = purchased_at_ms ? new Date(Number(purchased_at_ms)) : null;
    
    let platform = user.subscription?.platform || null;
    if (store === "APP_STORE" || store === "MAC_APP_STORE") platform = "ios";
    else if (store === "PLAY_STORE" || store === "AMAZON") platform = "android";
    else if (store === "STRIPE") platform = "stripe";

    let update = {};

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
      case "NON_RENEWING_PURCHASE":
      case "TRIAL_STARTED":
        update = {
          "subscription.plan": plan,
          "subscription.status": "active",
          "subscription.expiresAt": expiresAt,
          "subscription.startedAt": startedAt || user.subscription?.startedAt || new Date(),
          "subscription.isTrial": false,
          "subscription.platform": platform,
        };
        // Merge revenueCatId safely
        if (!user.subscription?.revenueCatId || (!user.subscription.revenueCatId.startsWith("$RCAnonymousID") && app_user_id.startsWith("$RCAnonymousID") === false)) {
            update["subscription.revenueCatId"] = app_user_id;
        }
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
        logger.info(`[RevenueCat Worker] Ignoring unhandled event: ${type}`);
        break;
    }

    if (Object.keys(update).length > 0) {
      await User.findByIdAndUpdate(user._id, { $set: update });
      
      // Clear Caches
      await Promise.all([
        invalidateMatchesCache(user._id, "profile").catch(() => {}),
        invalidateUserCache(user._id).catch(() => {})
      ]);

      // Emit Sub/Pub notification for Sockets
      await redisClient.publish(
        "job-events",
        JSON.stringify({
           type: "SUBSCRIPTION_UPDATED",
           userId: user._id.toString(),
           plan: update["subscription.plan"] || user.subscription?.plan || "free",
           status: update["subscription.status"] || user.subscription?.status || "expired"
        })
      );
    }

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
  logger.info(`[RevenueCat Worker] Job ${job.id} has completed!`);
});

revenueCatWorker.on("failed", (job, err) => {
  logger.error(`[RevenueCat Worker] Job ${job.id} has failed with ${err.message}`);
});

export default revenueCatWorker;
