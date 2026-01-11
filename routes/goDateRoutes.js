import express from 'express';
import { protect } from '../middleware/auth.js';
import { 
    createGoDate, 
    getAvailableDates, 
    getMyDates, 
    applyForDate, 
    acceptDateApplicant 
} from '../controllers/goDateController/goDateController.js';

const router = express.Router();

// ساخت دیت جدید (با چک کردن لیمیت)
router.post('/create', protect, createGoDate);

// گرفتن لیست دیت‌ها (برای تب Browse)
router.get('/all', protect, getAvailableDates);

// گرفتن دیت‌های خودم (برای تب My Plans)
router.get('/mine', protect, getMyDates);

// درخواست دادن برای یک دیت
router.post('/apply', protect, applyForDate);

// قبول کردن یک نفر (توسط سازنده)
router.post('/accept', protect, acceptDateApplicant);

export default router;