import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function simulateFocused() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    // Minimal schema to avoid noise
    const User = conn.model('User', new mongoose.Schema({
        username: String,
        questionsbycategoriesResults: mongoose.Schema.Types.Mixed,
        interests: [String]
    }, { strict: false }));
    
    const user = await User.findOne({ username: 'lastuser' }).lean();
    if (!user) {
        console.log("lastuser not found");
        process.exit(0);
    }
    
    console.log("--- LEAN DATA (What the API returns) ---");
    console.log(JSON.stringify(user.questionsbycategoriesResults, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

simulateFocused();
