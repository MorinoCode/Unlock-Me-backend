import mongoose from "mongoose";

const paymentLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true, // Idempotency: Ensure we process each RevenueCat event only once
      index: true,
    },
    appUserId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    productId: {
      type: String,
      required: true,
    },
    entitlementIds: {
      type: [String],
      default: [],
    },
    store: {
      type: String,
      enum: ["APP_STORE", "PLAY_STORE", "STRIPE", "PROMOTIONAL", "AMAZON"],
      default: "APP_STORE",
    },
    environment: {
      type: String,
      enum: ["PRODUCTION", "SANDBOX"],
      default: "PRODUCTION",
    },
    status: {
      type: String,
      enum: ["pending", "processed", "failed"],
      default: "pending",
    },
    errorLog: {
      type: String,
      default: null,
    },
    purchasedAtMs: {
      type: Number,
      default: null,
    },
    expirationAtMs: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("PaymentLog", paymentLogSchema);
