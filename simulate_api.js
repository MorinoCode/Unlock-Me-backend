import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function simulateApiResponse() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    // Define exactly as in User.js roughly
    const userSchema = new mongoose.Schema({
        username: String,
        questionsbycategoriesResults: {
            categories: { type: Map, of: Array }
        },
        interests: [String]
    });
    
    const User = conn.model('User', userSchema);
    
    const user = await User.findOne({ username: 'lastuser' });
    if (!user) {
        console.log("lastuser not found");
        process.exit(0);
    }
    
    console.log("--- DOCUMENT DATA ---");
    console.log(JSON.stringify(user.toObject(), null, 2));
    
    console.log("\n--- JSON RESPONSE (Simulated) ---");
    console.log(JSON.stringify(user, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

simulateApiResponse();
