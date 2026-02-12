import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function simulateQuestionsCall() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    // Exact logic from QuestionsByCategory
    const categories = ["Music", "Travel", "Sports"];
    const foundQuestions = await conn.collection('questionsbycategories').find({
      categoryLabel: { $in: categories },
    }).toArray();
    
    console.log(`Documents found: ${foundQuestions.length}`);
    
    const flattened = foundQuestions.flatMap((cat) =>
      (cat.questions || []).map((q) => ({
        text: q.questionText,
        category: cat.categoryLabel || cat.category || "",
      }))
    );
    
    console.log(`Total questions in flattened list: ${flattened.length}`);
    flattened.forEach((q, i) => {
        console.log(`${i+1}. [${q.category}] ${q.text}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

simulateQuestionsCall();
