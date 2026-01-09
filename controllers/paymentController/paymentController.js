import Stripe from 'stripe';
import dotenv from 'dotenv';
import User from '../../models/User.js'; // مدل یوزر را ایمپورت کنید (برای اطمینان)

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ 1. تابع جدید: دریافت لیست پلن‌ها از استرایپ برای نمایش در فرانت‌اند
export const getSubscriptionPlans = async (req, res) => {
  try {
    // دریافت تمام قیمت‌های فعال از استرایپ + اطلاعات محصول مرتبط
    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product'], // برای دسترسی به نام محصول (Gold/Platinum)
    });

    // مرتب‌سازی و ساده‌سازی داده‌ها برای ارسال به فرانت‌اند
    const plans = prices.data.map((price) => ({
      id: price.id,                 // Price ID (مثلاً price_12345)
      nickname: price.nickname,     // نام بازه (Monthly/Yearly)
      amount: price.unit_amount / 100, // تبدیل سنت به دلار (مثلاً 999 -> 9.99)
      currency: price.currency,
      interval: price.recurring?.interval, // month یا year
      productName: price.product.name,     // نام محصول (Gold Member, Platinum)
      // اگر در داشبورد استرایپ برای محصول Metadata ست کرده باشید، اینجا می‌آید
      features: price.product.metadata.features 
        ? JSON.parse(price.product.metadata.features) 
        : [], 
    }));

    res.status(200).json(plans);
  } catch (error) {
    console.error("Stripe Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch plans from Stripe" });
  }
};

// ✅ 2. تابع اصلاح شده: ساخت لینک پرداخت با Price ID دریافتی
export const createCheckoutSession = async (req, res) => {
  try {
    // ✅ تغییر: گرفتن planName از بدنه درخواست
    const { priceId, planName } = req.body; 
    const userId = req.user._id;

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    const user = await User.findById(userId);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
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
        planName: planName || 'premium', 
      },

      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/upgrade`,
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error("Checkout Session Error:", error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};