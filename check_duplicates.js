import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function checkDuplicates() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    const categories = ["Music", "Sports", "Travel"];
    const docs = await conn.collection('questionsbycategories').find({ categoryLabel: { $in: categories } }).toArray();
    
    const allTexts = [];
    docs.forEach(doc => {
        doc.questions.forEach(q => {
            allTexts.push({ text: q.questionText, category: doc.categoryLabel });
        });
    });
    
    console.log(`Total questions for Music, Sports, Travel: ${allTexts.length}`);
    
    const countMap = {};
    allTexts.forEach(q => {
        countMap[q.text] = (countMap[q.text] || 0) + 1;
    });
    
    const duplicates = Object.keys(countMap).filter(text => countMap[text] > 1);
    
    if (duplicates.length > 0) {
        console.log("\n⚠️ DUPLICATE QUESTION TEXTS FOUND:");
        duplicates.forEach(text => {
            console.log(`- "${text}": found in ${countMap[text]} places.`);
        });
    } else {
        console.log("\n✅ No duplicate question texts found.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkDuplicates();
