import "dotenv/config";
import { createClient } from 'redis';

/**
 * اسکریپت ساده برای فعال نگه داشتن Redis Cloud
 * این اسکریپت به Redis وصل می‌شه و یک عملیات ساده انجام می‌ده
 * تا دیتابیس به عنوان "فعال" شناسایی بشه
 */

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
  process.exit(1);
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis Cloud successfully! 🚀');
});

async function keepRedisActive() {
  try {
    // اتصال به Redis
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('🔌 Connected to Redis...');
    }

    // انجام یک عملیات ساده برای فعال نگه داشتن Redis
    const timestamp = new Date().toISOString();
    const keepAliveKey = 'unlock-me:keep-alive';
    
    // نوشتن یک key ساده
    await redisClient.set(keepAliveKey, timestamp);
    console.log('📝 Set keep-alive key:', keepAliveKey);
    
    // خواندن همان key
    const value = await redisClient.get(keepAliveKey);
    console.log('📖 Read keep-alive value:', value);
    
    // تنظیم TTL برای 7 روز (تا key خیلی بزرگ نشه)
    await redisClient.expire(keepAliveKey, 7 * 24 * 60 * 60); // 7 days
    console.log('⏰ Set TTL to 7 days');
    
    // بررسی وضعیت اتصال
    const info = await redisClient.info('server');
    console.log('ℹ️  Redis is active and responding!');
    
    console.log('\n✅ Redis successfully activated! Your database will not be deleted.');
    
    // بستن اتصال
    await redisClient.quit();
    console.log('👋 Connection closed gracefully.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error activating Redis:', error.message);
    process.exit(1);
  }
}

// اجرای اسکریپت
keepRedisActive();
