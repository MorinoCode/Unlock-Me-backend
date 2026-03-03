import mongoose from 'mongoose';
import dotenv from 'dotenv'

dotenv.config()

// ✅ Critical Fix: Retry logic for database connection
let retryCount = 0;
const MAX_RETRIES = 5;

const connectDB = async () => {
  while (retryCount < MAX_RETRIES) {
    try {
      // تنظیمات حرفه‌ای برای پرفورمنس بالا (Production Ready)
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        // ✅ SCALE FIX #8: Raised from 10 → 100 for 1M user capacity
        // At 1M users: 15 workers + API threads need far more than 10 connections
        maxPoolSize: 100,
        minPoolSize: 10,       // Keep 10 warm connections always ready
        
        // اگر سرور قطع شد، تا ۵ ثانیه تلاش کن وصل شی
        serverSelectionTimeoutMS: 5000,
        
        // اگر کانکشنی ۴۵ ثانیه بیکار بود، ببندش تا رم آزاد شه
        socketTimeoutMS: 45000,
        
        // Heartbeat every 10s to detect lost connections faster
        heartbeatFrequencyMS: 10000,
        
        // استفاده از IPv4 (سازگاری بهتر با اکثر سرورها)
        family: 4
      });

      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      retryCount = 0; // Reset on success

      // مدیریت ارورهای بعد از اتصال (مثلا اگر وسط کار قطع شد)
      mongoose.connection.on('error', (err) => {
        console.error('🔥 MongoDB Runtime Error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB Disconnected. Mongoose will try to reconnect automatically...');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB Reconnected successfully');
      });

      return; // Success - exit function
    } catch (error) {
      retryCount++;
      console.error(`❌ MongoDB Connection Error (Attempt ${retryCount}/${MAX_RETRIES}):`, error.message);
      
      if (retryCount >= MAX_RETRIES) {
        console.error('🔥 Failed to connect to MongoDB after multiple attempts.');
        console.error('⚠️ Server will start but database features will be disabled.');
        console.error('⚠️ Please check your MONGO_URI and MongoDB server status.');
        // ✅ Critical Fix: DON'T CRASH - Let server start without DB
        // Server can still serve static content or return errors gracefully
        return;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s, 16s
      console.log(`⏳ Retrying in ${waitTime / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

export default connectDB;
