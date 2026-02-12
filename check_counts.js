import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function checkQuestionCounts() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    const questionSchema = new mongoose.Schema({
        categoryLabel: String,
        questions: Array
    }, { collection: 'questionsbycategories' }); // Verify collection name from import in controller
    
    const Question = conn.model('Question', questionSchema);
    
    const categories = ["Music", "Sports", "Travel"];
    const docs = await Question.find({ categoryLabel: { $in: categories } }).lean();
    
    console.log("--- Question Counts per Category ---");
    docs.forEach(doc => {
        console.log(`- ${doc.categoryLabel}: ${doc.questions?.length || 0} questions`);
    });
    
    const allDocs = await Question.find({}).lean();
    console.log(`\nTotal categories in DB: ${allDocs.length}`);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkQuestionCounts();
