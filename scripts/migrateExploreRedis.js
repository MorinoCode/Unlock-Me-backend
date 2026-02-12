import mongoose from "mongoose";
import User from "../models/User.js";
import { addToExploreIndex } from "../utils/redisMatchHelper.js";
import redisClient from "../config/redis.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

// Connect to Mongo
const connectMongo = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Migration: Connected to MongoDB");
    } catch (err) {
        console.error("❌ MongoDB Error:", err);
        process.exit(1);
    }
};

const runMigration = async () => {
    await connectMongo();
    if (!redisClient.isOpen) await redisClient.connect();

    console.log("🚀 Starting Explore Index Migration...");
    
    // Process in batches
    const BATCH_SIZE = 100;
    let skip = 0;
    let processed = 0;
    let hasMore = true;

    while (hasMore) {
        const users = await User.find({})
            .select("name location gender interests createdAt")
            .limit(BATCH_SIZE)
            .skip(skip)
            .lean();

        if (users.length === 0) {
            hasMore = false;
            break;
        }

        const promises = users.map(user => addToExploreIndex(user));
        await Promise.all(promises);

        processed += users.length;
        skip += BATCH_SIZE;
        console.log(`✅ Indexed ${processed} users...`);
    }

    console.log(`🎉 Migration Complete! Total Users Indexed: ${processed}`);
    process.exit(0);
};

runMigration();
