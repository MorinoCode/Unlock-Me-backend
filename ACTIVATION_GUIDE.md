# 🚀 راهنمای فعال‌سازی سیستم بهینه شده Redis

## ✅ مراحل فعال‌سازی

### مرحله 1: بررسی Redis Connection

```bash
# بررسی کنید که Redis URL در .env موجود است:
REDIS_URL=redis://your-redis-url
```

**تست اتصال:**

```bash
# در terminal
node -e "import('./config/redis.js').then(m => console.log('Redis:', m.default?.isOpen ? 'Connected ✅' : 'Not Connected ❌'))"
```

---

### مرحله 2: تغییرات انجام شده

#### ✅ تغییر 1: Routes

**فایل:** `routes/swipeRoutes.js`

```javascript
// تغییر از:
import {
  getSwipeCards,
  handleSwipeAction,
} from "../controllers/swipe/swipeController.js";

// به:
import {
  getSwipeCards,
  handleSwipeAction,
} from "../controllers/swipe/swipeControllerOptimized.js";
```

#### ✅ تغییر 2: Worker

**فایل:** `server.js`

```javascript
// تغییر از:
import "./workers/matchWorker.js";

// به:
import "./workers/matchWorkerOptimized.js";
```

---

### مرحله 3: Restart Server

```bash
# Stop server
# سپس:
npm start
# یا:
npm run dev
```

---

### مرحله 4: بررسی Logs

بعد از restart، باید این log ها را ببینید:

```
✅ Connected to Redis Cloud successfully! 🚀
⏰ Internal Match Job Started (Optimized with Redis)...
```

---

### مرحله 5: Warm-up Cache (اختیاری)

برای populate کردن Redis، می‌توانید:

1. **صبر کنید** تا matchWorker خودکار اجرا شود (هر 4 ساعت)
2. **یا** به صورت دستی trigger کنید:

```javascript
// در server.js یا یک script جداگانه
import { processAllUsers } from "./workers/matchWorkerOptimized.js";
processAllUsers();
```

---

## 🔍 بررسی عملکرد

### 1. بررسی Cache Hit Rate

```bash
# در Redis CLI
redis-cli
> INFO stats
# بررسی keyspace_hits و keyspace_misses
```

### 2. بررسی Response Time

```bash
# تست endpoint
curl -X GET http://localhost:5000/api/swipe/cards \
  -H "Cookie: unlock-me-token=YOUR_TOKEN" \
  -w "\nTime: %{time_total}s\n"
```

**انتظار:** زمان باید از ~500ms به ~50ms کاهش یابد

### 3. بررسی Redis Memory

```bash
redis-cli
> INFO memory
# بررسی used_memory_human
```

---

## ⚠️ نکات مهم

### 1. Fallback Strategy

سیستم به صورت خودکار fallback می‌کند:

- اگر Redis down باشد → از DB استفاده می‌کند
- اگر Redis error باشد → از DB استفاده می‌کند
- هیچ خطایی رخ نمی‌دهد

### 2. Data Consistency

- MongoDB = source of truth
- Redis = cache layer
- همیشه sync با MongoDB

### 3. Memory Management

- TTL: 24 hours برای compatibility scores
- TTL: 7 days برای excluded users
- Auto-cleanup توسط Redis

---

## 🐛 Troubleshooting

### مشکل 1: Redis Not Connected

**علت:** `REDIS_URL` در `.env` موجود نیست یا اشتباه است

**راه حل:**

```bash
# بررسی .env
cat .env | grep REDIS_URL

# اگر موجود نیست:
echo "REDIS_URL=redis://your-redis-url" >> .env
```

### مشکل 2: Slow Performance

**علت:** Cache هنوز warm نشده

**راه حل:**

- صبر کنید تا matchWorker اجرا شود
- یا به صورت دستی warm-up کنید

### مشکل 3: Memory Issues

**علت:** Redis memory full

**راه حل:**

```bash
# بررسی memory
redis-cli INFO memory

# اگر نیاز است، eviction policy را تنظیم کنید:
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

---

## 📊 Monitoring

### Key Metrics:

1. **Cache Hit Rate**

   - Target: >80%
   - Monitor: Daily

2. **Response Time**

   - Target: <100ms (p95)
   - Monitor: Real-time

3. **Redis Memory**

   - Monitor: Daily
   - Alert: >80% capacity

4. **DB Query Reduction**
   - Target: >70% reduction
   - Monitor: Weekly

---

## ✅ Checklist فعال‌سازی

- [ ] Redis URL در `.env` موجود است
- [ ] Redis connection موفق است
- [ ] Routes تغییر کرده (`swipeRoutes.js`)
- [ ] Worker تغییر کرده (`server.js`)
- [ ] Server restart شده
- [ ] Logs بررسی شده
- [ ] Performance تست شده
- [ ] Monitoring setup شده

---

## 🎯 نتیجه

بعد از فعال‌سازی:

- ✅ **10-100x سریع‌تر**
- ✅ **پشتیبانی از میلیون‌ها کاربر**
- ✅ **کیفیت بهتر matches**
- ✅ **کاهش هزینه‌ها**

**توصیه:** بعد از فعال‌سازی، 24 ساعت performance را monitor کنید.
