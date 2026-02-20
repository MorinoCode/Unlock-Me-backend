import express from "express";
import { handleCloudinaryWebhook } from "../controllers/webhookController/webhookController.js";
import { handleRevenueCatWebhook } from "../controllers/paymentController/revenuecatController.js";

const router = express.Router();

// Route: POST /api/webhooks/cloudinary
router.post("/cloudinary", handleCloudinaryWebhook);

// Route: POST /api/webhooks/revenuecat
router.post("/revenuecat", handleRevenueCatWebhook);

export default router;
