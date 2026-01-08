import express from 'express';
import { createCheckoutSession } from '../controllers/paymentController/paymentController.js';
// ⚠️ نکته: مسیر ایمپورت زیر را بر اساس ساختار پروژه‌تان چک کنید.
// این همان تابعی است که چک می‌کند کاربر لاگین است یا نه.
import { protect } from '../middleware/auth.js'; 

const router = express.Router();

// آدرس: /api/payment/create-session
// protect: یعنی فقط کاربر لاگین شده می‌تواند درخواست دهد
router.post('/create-session', protect, createCheckoutSession);

export default router;