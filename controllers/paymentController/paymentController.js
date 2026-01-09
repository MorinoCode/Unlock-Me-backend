import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

// اتصال به استرایپ با کلید مخفی (Secret Key)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (req, res) => {
  try {
    const { plan } = req.body;
    // فرض بر این است که میدل‌ور احراز هویت (Auth Middleware) آیدی کاربر را در req.user گذاشته است
    const userId = req.user._id; 

    // امنیت: چک می‌کنیم پلن درخواستی معتبر باشد
    if (!['gold', 'platinum'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // انتخاب Price ID مناسب از فایل .env
    const priceId = plan === 'gold' 
      ? process.env.STRIPE_PRICE_ID_GOLD 
      : process.env.STRIPE_PRICE_ID_PLATINUM;

    // ساخت سشن پرداخت در استرایپ
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1, // تعداد: ۱ اشتراک
        },
      ],
      mode: 'subscription', // حالت اشتراکی (ماهانه)
      
      // ✅ نکته امنیتی مهم:
      // ما آیدی کاربر و نوع پلن را در metadata ذخیره می‌کنیم.
      // وقتی پرداخت انجام شد، استرایپ این اطلاعات را به ما برمی‌گرداند 
      // تا بدانیم کدام کاربر پول داده است.
      metadata: {
        userId: userId.toString(),
        plan: plan
      },
      
      // آدرس‌هایی که کاربر بعد از پرداخت به آنجا برمی‌گردد (در فرانت‌اند)
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/upgrade`, // اگر پشیمان شد برگردد به صفحه آپگرید
    });

    // لینک پرداخت را به فرانت‌اند می‌فرستیم
    res.json({ url: session.url });

  } catch (error) {
    console.error("Stripe Error:", error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};