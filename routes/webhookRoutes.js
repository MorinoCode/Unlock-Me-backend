import express from 'express';
import Stripe from 'stripe';
import User from '../models/User.js'; // مدل یوزر خودتان
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// این تابع برای همگام‌سازی با RevenueCat است (با fetch)
// این تابع برای همگام‌سازی با RevenueCat است
const syncToRevenueCat = async (userId, stripeSubId) => {
  try {
    console.log(`🔄 Syncing User ${userId} to RevenueCat...`);
    
    const response = await fetch('https://api.revenuecat.com/v1/receipts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REVENUECAT_PUBLIC_API_KEY}`, // کلید Public
        'Content-Type': 'application/json',
        'X-Platform': 'stripe' // پلتفرم استرایپ
      },
      body: JSON.stringify({
        app_user_id: userId.toString(), // مطمئن می‌شویم استرینگ است
        fetch_token: stripeSubId        // آیدی اشتراک استرایپ
        // ❌ خط attributes را پاک کردیم چون باعث ارور بود
      })
    });
    
    // خواندن پاسخ برای دیباگ بهتر
    const data = await response.json();

    if(response.ok) {
      console.log("✅ RevenueCat Synced Successfully!", data);
    } else {
      console.error("❌ RevenueCat Sync Failed:", JSON.stringify(data));
    }
    
  } catch (err) {
    console.error("❌ RC Network Error:", err);
  }
};

// وب‌هوک باید Raw Body بگیرد
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // ۱. اعتبارسنجی امضا (Security Check)
    // مطمئن می‌شویم که پیام واقعاً از طرف استرایپ آمده نه یک هکر
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`⚠️ Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ۲. بررسی نوع رویداد
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // اطلاعاتی که موقع خرید در metadata گذاشته بودیم
    const userId = session.metadata.userId;
    const plan = session.metadata.plan; 
    const subscriptionId = session.subscription;

    console.log(`💰 Payment Successful! User: ${userId}, Plan: ${plan}`);

    // ۳. آپدیت دیتابیس لوکال (اختیاری ولی برای سرعت خوب است)
    try {
      // محاسبه تاریخ انقضا (۳۰ روز از امروز)
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 30);

      await User.findByIdAndUpdate(userId, {
        $set: {
          "subscription.plan": plan,          // مثلا 'gold' یا 'platinum'
          "subscription.status": 'active',    // وضعیت فعال
          "subscription.expiresAt": expirationDate, // تاریخ انقضا
          // اگر فیلدی برای آیدی اشتراک در اسکیما دارید اضافه کنید، اگر نه این خط را پاک کنید:
          // "subscription.stripeId": subscriptionId 
        }
      });
      
      console.log("✅ Local Database Updated Correctly (Nested Fields)");
    } catch (dbErr) {
      console.error("❌ DB Update Error:", dbErr);
    }

    // ۴. آپدیت RevenueCat (حیاتی برای موبایل)
    await syncToRevenueCat(userId, subscriptionId);
  }

  // باید سریعاً به استرایپ جواب ۲۰0 بدهیم تا دوباره تلاش نکند
  res.json({ received: true });
});

export default router;