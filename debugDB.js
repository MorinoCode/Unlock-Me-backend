// debugDB.js
import mongoose from "mongoose";
import User from "./models/User.js"; // مسیر مدل را چک کن
import dotenv from "dotenv";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("🔍 Connected to DB. Searching for a user with matches...");
    
    // یک کاربر پیدا کن که لیست مچ‌هایش پر شده باشد
    const user = await User.findOne({ 
        "potentialMatches.0": { $exists: true } 
    }).select("name potentialMatches");

    if (!user) {
        console.log("❌ No user found with calculated matches!");
    } else {
        console.log(`✅ User found: ${user.name}`);
        console.log(`📊 Total Matches stored: ${user.potentialMatches.length}`);
        console.log("--- First 3 Matches inside DB ---");
        console.log(JSON.stringify(user.potentialMatches.slice(0, 3), null, 2));
    }
    
    process.exit();
  })
  .catch(err => console.error(err));