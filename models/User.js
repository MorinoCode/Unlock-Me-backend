import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    gender: String,
    lookingFor: String,
    role: { type: String, default: "user" },
    birthday: { type: String },
    interests: [String],
    avatar: String,
  },
  { timestamps: true }
);


const User = mongoose.model("User", userSchema);
export default User;
