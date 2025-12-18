import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  label: { type: String, required: true },
  icon: { type: String, required: true },
});

const initialQuizzesSchema = new mongoose.Schema({
  name: { type: String, required: true }, 
  categories: [categorySchema],           
});

export default mongoose.model("InitialQuizzes", initialQuizzesSchema);
