import express from "express";
import { handleCloudinaryWebhook } from "../controllers/webhookController/webhookController.js";
import { revenueCatWebhook } from "../controllers/paymentController/paymentController.js";

const router = express.Router();

// Route: POST /api/webhooks/cloudinary
router.post("/cloudinary", handleCloudinaryWebhook);

// Route: POST /api/webhooks/revenuecat
router.post("/revenuecat", revenueCatWebhook);

export default router;
