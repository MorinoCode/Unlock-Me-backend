import Stripe from "stripe";
import dotenv from "dotenv";
import User from "../../models/User.js";
import { getAppCache, setAppCache } from "../../utils/cacheHelper.js";

dotenv.config();
const PLANS_CACHE_TTL = 3600; // 1 hour

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// نگاشت کشور به ارز (کد ISO کشور -> کد ارز Stripe)
const COUNTRY_TO_CURRENCY = {
  SE: "sek",
  SV: "usd", // ✅ Fix #19: SV is El Salvador (uses USD), not Sweden (SE is Sweden)
  US: "usd",
  GB: "gbp",
  CA: "cad",
  AU: "aud",
  NZ: "nzd",
  DE: "eur",
  FR: "eur",
  IT: "eur",
  ES: "eur",
  NL: "eur",
  AT: "eur",
  BE: "eur",
  FI: "eur",
  IE: "eur",
  PT: "eur",
  NO: "nok",
  DK: "dkk",
  PL: "pln",
  CH: "chf",
  CZ: "czk",
  IN: "inr",
  JP: "jpy",
  CN: "cny",
  KR: "krw",
  BR: "brl",
  MX: "mxn",
  RU: "rub",
  AE: "aed",
  SA: "sar",
  EG: "egp",
  TR: "try",
  IL: "ils",
};

function getCurrencyFromCountry(country) {
  if (!country || typeof country !== "string") return null;
  const code = country.trim().toUpperCase().slice(0, 2);
  return COUNTRY_TO_CURRENCY[code] || null;
}

// ✅ 1. دریافت لیست پلن‌ها با پشتیبانی ارز بر اساس کشور/پارامتر
export const getSubscriptionPlans = async (req, res) => {
  try {
    const requestedCurrency =
      (req.query.currency || "").toLowerCase().trim() || null;
    let preferredCurrency = requestedCurrency;
    if (!preferredCurrency && req.user != null) {
      const userId = req.user._id ?? req.user.userId;
      if (userId) {
        const user = await User.findById(userId).select("location").lean();
        const country = user?.location?.country;
        preferredCurrency = getCurrencyFromCountry(country);
      }
    }
    const cacheKey = `subscription_plans_${preferredCurrency || "default"}`;
    const cached = await getAppCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
    });

    // گروه‌بندی بر اساس product.id و انتخاب یک قیمت به‌ازای هر محصول (ترجیح ارز کاربر)
    const byProduct = {};
    for (const price of prices.data) {
      const productId = price.product?.id ?? price.product;
      if (!productId) continue;
      const product =
        price.product?.object === "product" ? price.product : null;
      if (!byProduct[productId]) byProduct[productId] = { product, prices: [] };
      byProduct[productId].prices.push(price);
    }

    const plans = [];
    for (const productId of Object.keys(byProduct)) {
      const { product, prices: productPrices } = byProduct[productId];
      const productName = product?.name ?? "Plan";
      let chosen = productPrices[0];
      if (preferredCurrency) {
        const match = productPrices.find(
          (p) => (p.currency || "").toLowerCase() === preferredCurrency
        );
        if (match) chosen = match;
      }
      // ✅ Bug Fix: Handle zero-decimal currencies (JPY, KRW, etc.)
      const ZERO_DECIMAL_CURRENCIES = ['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'];
      const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.includes(chosen.currency?.toLowerCase());
      plans.push({
        id: chosen.id,
        nickname: chosen.nickname,
        amount:
          chosen.unit_amount != null
            ? isZeroDecimal ? chosen.unit_amount : Math.round(chosen.unit_amount / 100)
            : null,
        currency: chosen.currency?.toLowerCase() || chosen.currency,
        interval: chosen.recurring?.interval || "month",
        productName,
        features: product?.metadata?.features
          ? typeof product.metadata.features === "string"
            ? (() => {
                try {
                  return JSON.parse(product.metadata.features);
                } catch {
                  return [];
                }
              })()
            : product.metadata.features
          : [],
      });
    }

    const sorted = plans.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    await setAppCache(cacheKey, sorted, PLANS_CACHE_TTL);
    res.status(200).json(sorted);
  } catch (error) {
    console.error("Stripe Fetch Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ 2. تابع اصلاح شده: ساخت لینک پرداخت با Price ID دریافتی
export const createCheckoutSession = async (req, res) => {
  try {
    // ✅ تغییر: گرفتن planName از بدنه درخواست
    const { priceId, planName } = req.body;
    const userId = req.user._id;

    if (!priceId) {
      return res.status(400).json({ error: "Price ID is required" });
    }

    const user = await User.findById(userId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user?.email,

      // ✅ تغییر مهم: ارسال planName در متادیتا برای استفاده در Webhook
      metadata: {
        userId: userId.toString(),
        planName: planName || "premium",
      },

      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/upgrade`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Checkout Session Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ Cancel Subscription (now actually cancels Stripe subscription)
export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has an active subscription
    if (user.subscription?.status !== "active" || user.subscription?.plan === "free") {
      return res.status(400).json({ message: "No active subscription to cancel" });
    }

    // ✅ Cancel the actual Stripe subscription (if we have the ID)
    const stripeSubId = user.subscription?.stripeSubscriptionId;
    if (stripeSubId) {
      try {
        // cancel_at_period_end = true → user keeps access until end of billing period
        await stripe.subscriptions.update(stripeSubId, {
          cancel_at_period_end: true
        });
        console.log(`✅ Stripe subscription ${stripeSubId} set to cancel at period end`);
      } catch (stripeErr) {
        // If subscription already canceled or not found, log but continue
        console.warn(`⚠️ Stripe cancel warning for ${stripeSubId}:`, stripeErr.message);
      }
    } else {
      console.warn(`⚠️ No stripeSubscriptionId found for user ${userId}. DB-only cancel.`);
    }

    // Update subscription status to canceled in DB
    // Keep expiresAt as is (user keeps access until expiry)
    await User.findByIdAndUpdate(userId, {
      $set: {
        "subscription.status": "canceled"
      }
    });

    res.status(200).json({ 
      message: "Subscription canceled successfully",
      subscription: {
        plan: user.subscription.plan,
        status: "canceled",
        expiresAt: user.subscription.expiresAt
      }
    });
  } catch (error) {
    console.error("Cancel Subscription Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ Improvement #20: Change Plan (modify existing Stripe subscription instead of new checkout)
export const changePlan = async (req, res) => {
  try {
    const { priceId, planName } = req.body;
    const userId = req.user._id || req.user.userId;

    if (!priceId || !planName) {
      return res.status(400).json({ error: "Price ID and plan name are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const stripeSubId = user.subscription?.stripeSubscriptionId;

    // If user has an active Stripe subscription, modify it instead of creating a new one
    if (stripeSubId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(stripeSubId);
        if (subscription && subscription.status !== 'canceled') {
          // Update the subscription with the new price
          const updatedSubscription = await stripe.subscriptions.update(stripeSubId, {
            items: [{
              id: subscription.items.data[0].id,
              price: priceId,
            }],
            proration_behavior: 'create_prorations',
          });

          // Update local DB
          const planLower = planName.toLowerCase();
          let planType = 'premium';
          if (planLower.includes('diamond')) planType = 'diamond';
          else if (planLower.includes('platinum')) planType = 'platinum';
          else if (planLower.includes('gold')) planType = 'gold';

          await User.findByIdAndUpdate(userId, {
            $set: {
              "subscription.plan": planType,
              "subscription.status": "active",
            }
          });

          return res.json({ 
            success: true, 
            message: `Plan changed to ${planType}`,
            subscriptionId: updatedSubscription.id 
          });
        }
      } catch (stripeErr) {
        console.warn(`⚠️ Could not modify existing subscription: ${stripeErr.message}. Falling back to new checkout.`);
      }
    }

    // Fallback: Create new checkout session if no existing subscription
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user?.email,
      metadata: {
        userId: userId.toString(),
        planName: planName,
        isPlanChange: "true"
      },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/myprofile`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Change Plan Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};

// ✅ Verify Payment Session and Update Subscription (Fallback if webhook fails)
export const verifyPaymentAndUpdateSubscription = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user._id || req.user.userId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Retrieve session from Stripe with expanded line_items
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price.product', 'subscription']
    });

    // Security check: verify userId matches session metadata
    const sessionUserId = session.metadata?.userId;
    if (sessionUserId && sessionUserId !== userId.toString()) {
      return res.status(403).json({ error: "Session does not belong to this user" });
    }

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: "Payment not completed" });
    }

    // Extract plan name from metadata or product
    let planName = session.metadata?.planName;
    
    if (!planName && session.line_items?.data?.[0]?.price?.product) {
      try {
        const product = session.line_items.data[0].price.product;
        if (typeof product === 'object') {
          planName = product.name || product.metadata?.planName;
        } else {
          // If product is just an ID, retrieve it
          const productObj = await stripe.products.retrieve(product);
          planName = productObj.name || productObj.metadata?.planName;
        }
      } catch (err) {
        console.error("Error fetching product:", err);
      }
    }

    // Fallback: get from subscription
    if (!planName && session.subscription) {
      try {
        const subscriptionId = typeof session.subscription === 'string' 
          ? session.subscription 
          : session.subscription.id;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price.product']
        });
        const price = subscription.items.data[0]?.price;
        if (price?.product) {
          const product = price.product;
          if (typeof product === 'object') {
            planName = product.name || product.metadata?.planName;
          } else {
            const productObj = await stripe.products.retrieve(product);
            planName = productObj.name || productObj.metadata?.planName;
          }
        }
      } catch (err) {
        console.error("Error fetching subscription:", err);
      }
    }

    planName = planName || 'premium';

    // Determine plan type
    let planType = 'free';
    const planLower = planName.toLowerCase();
    if (planLower.includes('diamond')) {
      planType = 'diamond';
    } else if (planLower.includes('platinum')) {
      planType = 'platinum';
    } else if (planLower.includes('gold')) {
      planType = 'gold';
    } else {
      // ✅ Bug Fix: Any paid plan that doesn't match specific tiers gets premium
      planType = 'premium';
    }

    // Calculate expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Get Stripe subscription ID from session
    const stripeSubId = typeof session.subscription === 'string' 
      ? session.subscription 
      : session.subscription?.id || null;

    // Update database
    const updatedUser = await User.findByIdAndUpdate(userId, {
      $set: {
        "subscription.plan": planType,
        "subscription.status": "active",
        "subscription.expiresAt": expiresAt,
        "subscription.stripeSubscriptionId": stripeSubId,
        "subscription.stripeCustomerId": session.customer || null,
        "subscription.isTrial": false,         // ✅ Payment success: trial ends
        "subscription.trialExpiresAt": null,   // ✅ Payment success: trial ends
        "subscription.startedAt": new Date()   // ✅ Record start date
      }
    }, { new: true });

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`✅ Subscription verified and updated. User ${userId} now has plan: ${planType}`);

    res.json({ 
      success: true,
      plan: planType,
      expiresAt: expiresAt.toISOString(),
      message: "Subscription updated successfully"
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);
    const errorMessage =
      process.env.NODE_ENV === "production"
        ? "Server error. Please try again later."
        : error.message;
    res.status(500).json({ error: errorMessage });
  }
};
