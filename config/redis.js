import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis Cloud successfully! 🚀'));

// اتصال به ردیس به محض ایمپورت شدن این فایل
(async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
})();

export default redisClient;