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
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Webhook signature verification failed" 
      : err.message;
    return res.status(400).send(`Webhook Error: ${errorMessage}`);
  }

  // 2. هندل کردن موفقیت پرداخت
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // دریافت اطلاعات از Metadata که در paymentController ست کردیم
    const userId = session.metadata?.userId;
    let planName = session.metadata?.planName;
    const subscriptionId = session.subscription;

    console.log(`🔍 Webhook received - User: ${userId}, PlanName (metadata): ${planName}, Subscription: ${subscriptionId}`);

    // اگر planName در metadata نبود، session را expand کن و از line_items بگیر
    if (!planName) {
      try {
        // Retrieve session with expanded line_items
        const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items', 'line_items.data.price.product']
        });
        
        if (expandedSession.line_items?.data?.[0]?.price?.product) {
          const product = expandedSession.line_items.data[0].price.product;
          planName = typeof product === 'object' 
            ? (product.name || product.metadata?.planName) 
            : null;
          
          if (!planName && typeof product === 'string') {
            // اگر product فقط ID است، آن را retrieve کن
            const productObj = await stripe.products.retrieve(product);
            planName = productObj.name || productObj.metadata?.planName;
          }
        }
      } catch (err) {
        console.error("Error fetching session with line_items:", err);
      }
    }

    // Fallback: اگر هنوز planName نداریم، از subscription object بگیر
    if (!planName && subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price.product']
        });
        const price = subscription.items.data[0]?.price;
        if (price?.product) {
          const product = price.product;
          planName = typeof product === 'object' 
            ? (product.name || product.metadata?.planName) 
            : null;
          
          if (!planName && typeof product === 'string') {
            const productObj = await stripe.products.retrieve(product);
            planName = productObj.name || productObj.metadata?.planName;
          }
        }
      } catch (err) {
        console.error("Error fetching subscription:", err);
      }
    }

    planName = planName || 'premium';

    console.log(`💰 Payment Success for User: ${userId} - Plan: ${planName} - Subscription: ${subscriptionId}`);

    if (userId) {
      try {
        // تعیین plan type از planName
        let planType = 'free';
        const planLower = planName.toLowerCase();
        if (planLower.includes('diamond')) {
          planType = 'diamond';
        } else if (planLower.includes('platinum')) {
          planType = 'platinum';
        } else if (planLower.includes('gold')) {
          planType = 'gold';
        }

        // محاسبه تاریخ انقضا (30 روز بعد)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // 3. آپدیت دیتابیس
        const updatedUser = await User.findByIdAndUpdate(userId, {
          $set: {
            "subscription.plan": planType,
            "subscription.status": 'active',
            "subscription.expiresAt": expiresAt,
          }
        }, { new: true });

        if (updatedUser) {
          console.log(`✅ Database Updated. User ${userId} now has plan: ${planType}`);
        } else {
          console.error(`❌ User ${userId} not found`);
        }

        // 4. آپدیت RevenueCat
        if (subscriptionId) {
          await syncToRevenueCat(userId, subscriptionId);
        }

      } catch (err) {
        console.error("❌ Error updating user subscription:", err);
        console.error("Error details:", {
          message: err.message,
          stack: err.stack,
          userId,
          planName,
          subscriptionId
        });
      }
    } else {
      console.error("❌ No userId found in session metadata");
      console.log("Session metadata:", session.metadata);
    }
  }

  // پاسخ سریع به استرایپ
  res.json({ received: true });
});

export default router;