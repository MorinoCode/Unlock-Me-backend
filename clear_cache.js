import { createClient } from 'redis';
import { redisConnectionConfig } from './config/redis.js';

const client = createClient(redisConnectionConfig);

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
