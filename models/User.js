import mongoose from "mongoose";

function arrayLimit(val) {
  return val.length <= 6;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true,     
      minlength: 3,
      maxlength: 15
    },
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

    superLikedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    superLikedBy: [
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
    phone: { type: String, default: "" },
    detailedAddress: { type: String, default: "" },
    gallery: {
      type: [String],
      validate: [arrayLimit, "{PATH} exceeds the limit of 6"],
    },
    voiceIntro: { type: String, default: "" },
    dna: {
    Logic: { type: Number, default: 50 },
    Emotion: { type: Number, default: 50 },
    Energy: { type: Number, default: 50 },
    Creativity: { type: Number, default: 50 },
    Discipline: { type: Number, default: 50 }
  },
  potentialMatches: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      matchScore: Number, // امتیار را هم ذخیره می‌کنیم که بعداً راحت سورت کنیم
      updatedAt: { type: Date, default: Date.now }
    }
  ],

  // یک تاریخ که بدانیم آخرین بار کی برای این یوزر مچ پیدا کردیم
  lastMatchCalculation: { type: Date, default: null }
  },
  { timestamps: true }
);

// ✅ 1. ایندکس برای جستجوی لوکیشن (برای Nearby و فیلتر کشور)
userSchema.index({ "location.country": 1, "location.city": 1 });

// ✅ 2. ایندکس برای پیدا کردن جدیدترین‌ها (برای Newest)
userSchema.index({ "location.country": 1, createdAt: -1 });

// ✅ 3. ایندکس برای فیلتر جنسیت (ترکیبی با کشور)
userSchema.index({ "location.country": 1, gender: 1 });

const User = mongoose.model("User", userSchema);
export default User;
