import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    gender: { type: String },
    lookingFor: { type: String },
    role: { type: String, default: "user" },
    
    // Updated birthday to store day, month, year separately
    birthday: {
      day: String,
      month: String,
      year: String
    },

    // New Fields for Onboarding
    location: {
      country: { type: String, default: "" },
      city: { type: String, default: "" }
    },
    bio: { 
      type: String, 
      maxlength: 150, 
      default: "" 
    },

    interests: [String],
    avatar: { type: String, default: "" },

    questionsbycategoriesResults: {
      categories: {
        type: Map,
        of: [
          {
            questionText: String,
            selectedText: String,
            trait: String,
            answeredAt: { type: Date, default: Date.now },
          },
        ],
        default: {},
      },
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
export default User;