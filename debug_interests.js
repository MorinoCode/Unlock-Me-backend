import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function debugInterests() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    console.log("Connected to MongoDB");

    const UserSchema = new mongoose.Schema({ 
      questionsbycategoriesResults: { categories: { type: Map, of: Array } },
      interests: [String]
    });

    const User = conn.model('User', UserSchema);

    // Find the most recently created user who has some quiz results
    const user = await User.findOne({ 
      "questionsbycategoriesResults.categories": { $exists: true } 
    }).sort({ createdAt: -1 });

    if (user) {
      console.log("\n👤 Found User Data:");
      console.log(`Interests: ${user.interests?.join(", ") || 'None'}`);
      
      const categoriesMap = user.questionsbycategoriesResults.categories;
      console.log("\n🧪 Raw Map Keys check:");
      if (categoriesMap instanceof Map) {
        for (const key of categoriesMap.keys()) {
          console.log(`  Key: "${key}" (Length: ${categoriesMap.get(key).length})`);
        }
      } else {
        Object.keys(categoriesMap || {}).forEach(key => {
            console.log(`  Key: "${key}" (Length: ${categoriesMap[key]?.length || 0})`);
        });
      }
    } else {
      console.log("\n❌ No user found with quiz results.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debugInterests();
