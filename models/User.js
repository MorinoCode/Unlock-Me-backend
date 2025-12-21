import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    gender: { type: String },
    lookingFor: { type: String },
    role: { type: String, default: "user" },

    birthday: {
      day: String,
      month: String,
      year: String,
    },

    location: {
      country: { type: String, default: "" },
      city: { type: String, default: "" },
    },
    bio: {
      type: String,
      maxlength: 150,
      default: "",
    },
    subscription: {
      plan: {
        type: String,
        enum: ["free", "premium", "gold"],
        default: "free",
      },
      expiresAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["active", "expired", "canceled"],
        default: "active",
      },
    },
    likedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    likedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    dislikedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

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
