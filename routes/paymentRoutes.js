import express from 'express';
import { 
    createCheckoutSession, 
    getSubscriptionPlans // <--- این تابع را اضافه کردیم
} from '../controllers/paymentController/paymentController.js';

import { protect } from '../middleware/auth.js'; 

const router = express.Router();

// ✅ روت جدید: دریافت قیمت‌ها (معمولاً نیازی به لاگین ندارد تا همه قیمت را ببینند، اما اگر بخواهید می‌توانید protect بگذارید)
router.get('/plans', getSubscriptionPlans);

// روت قبلی: ساخت لینک پرداخت (حتماً باید لاگین باشد)
router.post('/create-session', protect, createCheckoutSession);

export default router;