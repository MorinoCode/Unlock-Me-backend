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
    refreshToken: { type: String, select: false }, // ✅ Security Fix: Store refresh token

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: "Other", // ✅ Bug Fix: Default must match enum value
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
      publicId: { type: String, default: null }, // Useful for deleting from Cloudinary later
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
        enum: ["active", "expired", "canceled"],
        default: "active",
      },
      // ✅ RevenueCat Specific Fields
      revenueCatId: { type: String, default: null }, // Original App User ID in RevenueCat
      platform: { type: String, enum: ["ios", "android", "stripe", null], default: null },
      activeEntitlements: { type: [String], default: [] }, // Array of active entitlements (e.g. ['premium'])

      isTrial: { type: Boolean, default: false },          // ✅ Free trial flag
      trialExpiresAt: { type: Date, default: null },       // ✅ When the 7-day trial ends
      startedAt: { type: Date, default: Date.now },        // ✅ When the current plan/trial started
    },

    usage: {
      unlocksCount: { type: Number, default: 0 },
      keysUsedToday: { type: Number, default: 0 }, // ✅ New: Track daily key usage
      superLikesCount: { type: Number, default: 0 },
      directMessagesCount: { type: Number, default: 0 },
      blindDatesCount: { type: Number, default: 0 },
      lastBlindDateAt: { type: Date, default: null },
      lastunlockDate: { type: Date, default: null }, // ✅ Critical Fix: Add missing field
      lastResetDate: { type: Date, default: Date.now },
    },

    likedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dislikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    superLikedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // ✅ Bug Fix: Explicit matches array for mutual matches
    matches: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // ✅ Block User Feature
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    
    // ✅ Unlock Feature Persistence
    unlockedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

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

// ✅ Performance Fix: Database Indexes
userSchema.index({ "location.country": 1, "location.city": 1 });
userSchema.index({ "location.country": 1, createdAt: -1 });
userSchema.index({ "location.country": 1, gender: 1 });
userSchema.index({ location: "2dsphere" });
// email and username: index created by unique: true in schema — do not add duplicate
userSchema.index({ "dna.Logic": 1, "dna.Emotion": 1, "dna.Energy": 1 }); // For DNA queries
userSchema.index({ lastMatchCalculation: 1 }); // For match worker
userSchema.index({ "subscription.plan": 1, "subscription.status": 1 }); // For subscription queries
userSchema.index({ likedUsers: 1 }); // For match queries
userSchema.index({ likedBy: 1 }); // For match queries
userSchema.index({ dislikedUsers: 1 }); // For unlock: "users who disliked me" exclusion
userSchema.index({ blockedUsers: 1 }); // For block feature
userSchema.index({ blockedBy: 1 }); // For block feature
userSchema.index({ createdAt: -1 }); // For sorting by newest

// ✅ unlock fallback query: country + gender + dna (compound for getCandidatesFromDB / getunlockCards)
userSchema.index({ "location.country": 1, gender: 1, dna: 1 });
// ✅ Explore "nearby" + sort by new: country + city + createdAt
userSchema.index({ "location.country": 1, "location.city": 1, createdAt: -1 });

const User = mongoose.model("User", userSchema);
export default User;
