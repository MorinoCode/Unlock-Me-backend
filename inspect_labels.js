import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unlockme";

async function inspectLabels() {
  try {
    const conn = await mongoose.createConnection(MONGO_URI).asPromise();
    
    // Check both field names just in case
    const docs = await conn.collection('questionsbycategories').find({}).toArray();
    
    console.log("--- All Category Labels ---");
    docs.forEach(doc => {
        console.log(`ID: ${doc._id} | categoryLabel: "${doc.categoryLabel}" | category: "${doc.category}" | Questions: ${doc.questions?.length || 0}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

inspectLabels();
