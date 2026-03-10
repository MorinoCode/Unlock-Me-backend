import mongoose from "mongoose";

function arrayLimit(val) {
  return val.length <= 6;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 15,
    },
    password: { type: String, required: true, select: false },
    refreshToken: { type: String, select: false },
    fcmTokens: { type: [String], default: [] },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: "Other",
      trim: true,
    },

    lookingFor: {
      type: String,
      enum: ["Male", "Female", "Other"],
      trim: true,
    },

    role: { type: String, default: "user" },

    verification: {
      status: { 
        type: String, 
        enum: ['unverified', 'pending', 'verified', 'rejected'], 
        default: 'unverified' 
      },
      mediaUrl: { type: String, default: null }, 
      publicId: { type: String, default: null },
      requestedAt: { type: Date, default: null }
    },

    birthday: {
      day: String,
      month: String,
      year: String,
    },

    bio: {
      type: String,
      maxlength: 150,
      default: "",
      trim: true,
    },

    subscription: {
      plan: {
        type: String,
        enum: ["free", "gold", "platinum", "diamond"],
        default: "free",
      },
      expiresAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["active", "expired", "canceled", "inactive"],
        default: "inactive",
      },
      revenueCatId: { type: String, default: null },
      platform: { type: String, enum: ["ios", "android", "stripe", null], default: null },
      activeEntitlements: { type: [String], default: [] },
      isTrial: { type: Boolean, default: false },
      startedAt: { type: Date, default: Date.now },
    },

    usage: {
      unlocksCount: { type: Number, default: 0 },
      keysUsedToday: { type: Number, default: 0 },
      superLikesCount: { type: Number, default: 0 },
      directMessagesCount: { type: Number, default: 0 },
      blindDatesCount: { type: Number, default: 0 },
      lastBlindDateAt: { type: Date, default: null },
      lastunlockDate: { type: Date, default: null },
      lastResetDate: { type: Date, default: Date.now },
    },

    likedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dislikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    matches: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    unlockedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    soulmateMatches: {
      list: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          score: { type: Number },
        }
      ],
      calculatedAt: { type: Date, default: null },
    },

    lastActiveAt: { type: Date, default: Date.now },

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
      Discipline: { type: Number, default: 50 },
    },

    potentialMatches: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        matchScore: Number,
        updatedAt: { type: Date, default: Date.now },
      },
    ],

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
      country: { type: String, default: "", trim: true },
      city: { type: String, default: "", trim: true },
    },

    lastMatchCalculation: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ "location.country": 1, "location.city": 1 });
userSchema.index({ "location.country": 1, createdAt: -1 });
userSchema.index({ "location.country": 1, gender: 1 });
userSchema.index({ location: "2dsphere" });
userSchema.index({ "dna.Logic": 1, "dna.Emotion": 1, "dna.Energy": 1 });
userSchema.index({ lastMatchCalculation: 1 });
userSchema.index({ "subscription.plan": 1, "subscription.status": 1 });
userSchema.index({ likedUsers: 1 });
userSchema.index({ likedBy: 1 });
userSchema.index({ dislikedUsers: 1 });
userSchema.index({ blockedUsers: 1 });
userSchema.index({ blockedBy: 1 });
userSchema.index({ createdAt: -1 });

userSchema.index({ "location.country": 1, gender: 1, dna: 1 });
userSchema.index({ "location.country": 1, "location.city": 1, createdAt: -1 });
userSchema.index({ "subscription.plan": 1, lastActiveAt: -1 });
userSchema.index({ "soulmateMatches.calculatedAt": 1 });

userSchema.index({ _id: 1, "usage.directMessagesCount": 1 });

const User = mongoose.model("User", userSchema);
export default User;
