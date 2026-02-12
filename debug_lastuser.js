import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function debugLastUser() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    console.log("Connected to MongoDB");

    const UserSchema = new mongoose.Schema({ 
      username: String,
      questionsbycategoriesResults: { categories: { type: Map, of: Array } },
      interests: [String],
      dna: Object
    });

    const User = conn.model('User', UserSchema);

    const user = await User.findOne({ username: 'lastuser' });

    if (user) {
      console.log("\n👤 User: lastuser");
      console.log(`Interests Array: ${JSON.stringify(user.interests)}`);
      console.log(`DNA: ${JSON.stringify(user.dna)}`);
      
      const categoriesMap = user.questionsbycategoriesResults.categories;
      console.log("\n🧪 Quiz Results Categories:");
      if (categoriesMap instanceof Map) {
        for (const [key, val] of categoriesMap.entries()) {
          console.log(`  - ${key}: ${val.length} answers`);
        }
      } else if (categoriesMap) {
        Object.keys(categoriesMap).forEach(key => {
          console.log(`  - ${key}: ${categoriesMap[key]?.length || 0} answers`);
        });
      } else {
          console.log("  (None found)");
      }
    } else {
      console.log("\n❌ User 'lastuser' not found.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debugLastUser();
