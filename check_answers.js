import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function checkAnswersContent() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    const User = conn.model('User', new mongoose.Schema({
        username: String,
        questionsbycategoriesResults: mongoose.Schema.Types.Mixed
    }, { strict: false }));
    
    const user = await User.findOne({ username: 'lastuser' }).lean();
    if (!user) {
        console.log("lastuser not found");
        process.exit(0);
    }
    
    const cats = user.questionsbycategoriesResults.categories;
    console.log("--- lastuser Answers ---");
    for (const cat in cats) {
        console.log(`\nCategory: ${cat}`);
        cats[cat].forEach((ans, i) => {
            console.log(`  ${i+1}. Q: "${ans.questionText}" | A: "${ans.selectedText}"`);
        });
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAnswersContent();
