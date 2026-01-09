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

    bio: {
      type: String,
      maxlength: 150,
      default: "",
    },

    // ✅ UPDATE: تغییر premium به platinum طبق لاجیک جدید
    subscription: {
      plan: {
        type: String,
        enum: ["free", "gold", "platinum"], // premium حذف و platinum اضافه شد
        default: "free",
      },
      expiresAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["active", "expired", "canceled"],
        default: "active",
      },
    },

    // ✅ NEW: بخش مدیریت مصرف روزانه (Usage Limits)
    usage: {
      // تعداد لایک‌های امروز
      swipesCount: { type: Number, default: 0 },
      // تعداد سوپر لایک‌های امروز
      superLikesCount: { type: Number, default: 0 },
      // تعداد دایرکت مسیج‌های امروز (بدون مچ)
      directMessagesCount: { type: Number, default: 0 },
      // تعداد ورود به بلایند دیت امروز
      blindDatesCount: { type: Number, default: 0 },
      
      // زمان آخرین بلایند دیت (برای محاسبه فاصله زمانی ۱ یا ۴ ساعته)
      lastBlindDateAt: { type: Date, default: null },
      
      // برای اینکه بفهمیم کی باید این عددها را صفر کنیم (ریست روزانه)
      lastResetDate: { type: Date, default: Date.now }
    },

    likedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dislikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

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
        matchScore: Number, 
        updatedAt: { type: Date, default: Date.now }
      }
    ],

    location: {
      type: {
        type: String,
        enum: ["Point"], 
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0], 
      },
      country: { type: String, default: "" },
      city: { type: String, default: "" },
    },

    lastMatchCalculation: { type: Date, default: null }
  },
  { timestamps: true }
);

// Indexes
userSchema.index({ "location.country": 1, "location.city": 1 });
userSchema.index({ "location.country": 1, createdAt: -1 });
userSchema.index({ "location.country": 1, gender: 1 });
userSchema.index({ "location": "2dsphere" });

const User = mongoose.model("User", userSchema);
export default User;