// backend/scripts/fixUserDna.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/User.js";
import { calculateUserDNA } from "./utils/matchUtils.js";

dotenv.config();

const runMigration = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to DB. Starting DNA migration (Bypassing Validation)...");

    const usersToFix = await User.find({
      $or: [
        { dna: { $exists: false } },
        { dna: null },
        { "dna.Logic": { $exists: false } }
      ]
    });

    console.log(`🔍 Found ${usersToFix.length} users with missing DNA.`);

    let successCount = 0;
    let failCount = 0;

    for (const user of usersToFix) {
      try {
        console.log(`⚙️ Processing user: ${user._id}`); // نام ممکن است نباشد، آیدی بهتر است

        // محاسبه DNA
        const newDna = calculateUserDNA(user, true);

        // 🟢 تغییر مهم: استفاده از updateOne به جای save
        // این دستور مستقیماً DNA را تزریق می‌کند و چک نمی‌کند که username هست یا نه
        await User.updateOne(
            { _id: user._id }, 
            { $set: { dna: newDna } }
        );
        
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to fix user ${user._id}:`, err.message);
        failCount++;
      }
    }

    console.log("------------------------------------------------");
    console.log(`🎉 Migration Finished!`);
    console.log(`✅ Fixed: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    
    process.exit(0);

  } catch (error) {
    console.error("🔥 Critical Error:", error);
    process.exit(1);
  }
};

runMigration();