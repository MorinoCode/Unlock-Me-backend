import redis from 'redis';
import dotenv from 'dotenv';
dotenv.config();

const client = redis.createClient({
    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`
});

async function clearQuestionsCache() {
  try {
    await client.connect();
    
    // The cache keys in cacheHelper use prefixes.
    // Based on onboardingController: getMatchesCache("global", cacheKey)
    // The prefix for global matches cache might be "matches:global:*"
    
    const keys = await client.keys('matches:global:questions_*');
    console.log(`Found ${keys.length} question cache keys.`);
    
    if (keys.length > 0) {
        await client.del(keys);
        console.log("Deleted all question cache keys.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

clearQuestionsCache();
