// models/Question.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  // In your DB screenshot, the field is "categoryLabel", not "category"
  categoryLabel: { type: String, required: true }, 
  
  questions: [
    {
      questionText: String,
      options: [
        {
          text: String,
          trait: String 
        }
      ]
    }
  ]
});

// Force the model to use the exact collection name from your screenshot
// Based on image 2, the collection name is "questionsbycategories"
export default mongoose.model("Question", questionSchema, "questionsbycategories");