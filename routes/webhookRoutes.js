import express from 'express';
import Stripe from 'stripe';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- تابع سینک با RevenueCat (برای اپلیکیشن موبایل) ---
const syncToRevenueCat = async (userId, stripeSubId) => {
  if (!process.env.REVENUECAT_PUBLIC_API_KEY) return; // اگر کلید نبود، رد شو

  try {
    console.log(`🔄 Syncing User ${userId} to RevenueCat...`);
    const response = await fetch('https://api.revenuecat.com/v1/receipts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REVENUECAT_PUBLIC_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Platform': 'stripe'
      },
      body: JSON.stringify({
        app_user_id: userId.toString(),
        fetch_token: stripeSubId
      })
    });
    
    if(response.ok) {
      console.log("✅ RevenueCat Synced Successfully!");
    } else {
      console.warn("⚠️ RevenueCat Sync Warning:", await response.text());
    }
  } catch (err) {
    console.error("❌ RevenueCat Network Error:", err);
  }
};

// --- Webhook Route ---
// نکته مهم: این روت باید Raw Body بگیرد، برای همین express.json اینجا نباید باشد
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // 1. اعتبارسنجی امضای استرایپ (امنیت)
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`⚠️ Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. هندل کردن موفقیت پرداخت
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // دریافت اطلاعات از Metadata که در paymentController ست کردیم
    const userId = session.metadata?.userId;
    const planName = session.metadata?.planName || 'premium'; // پیش‌فرض اگر ست نشده بود
    const subscriptionId = session.subscription;

    console.log(`💰 Payment Success for User: ${userId} - Plan: ${planName}`);

    if (userId) {
      try {
        // محاسبه تاریخ انقضا (30 روز بعد)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // 3. آپدیت دیتابیس
        await User.findByIdAndUpdate(userId, {
          $set: {
            "subscription.plan": planName.toLowerCase().includes('gold') ? 'gold' : 'platinum',
            "subscription.status": 'active',
            "subscription.expiresAt": expiresAt,
          }
        });
        console.log("✅ Database Updated.");

        // 4. آپدیت RevenueCat
        await syncToRevenueCat(userId, subscriptionId);

      } catch (err) {
        console.error("❌ Error updating user subscription:", err);
      }
    }
  }

  // پاسخ سریع به استرایپ
  res.json({ received: true });
});

export default router;