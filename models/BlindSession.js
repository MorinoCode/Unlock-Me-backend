import mongoose from "mongoose";

const BlindSessionSchema = new mongoose.Schema({
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  status: {
    type: String,
    enum: [
      "matching",
      "active",
      "waiting_for_stage_2",
      "waiting_for_stage_3",
      "waiting_for_reveal",
      "completed",
      "cancelled",
    ],
    default: "active",
  },
  currentStage: {
    type: Number,
    default: 1,
  },
  questions: [
    {
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BlindQuestion",
      },
      u1Answer: { type: Number, default: null },
      u2Answer: { type: Number, default: null },
    },
  ],
  currentQuestionIndex: {
    type: Number,
    default: 0,
  },
  messages: [
    {
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      text: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  stageProgress: {
    u1ReadyNext: { type: Boolean, default: false },
    u2ReadyNext: { type: Boolean, default: false },
  },
  revealDecision: {
    u1Reveal: { type: Boolean, default: false },
    u2Reveal: { type: Boolean, default: false },
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600,
  },
  u1RevealDecision: { 
    type: String, 
    enum: ['pending', 'yes', 'no'], 
    default: 'pending' 
  },
  u2RevealDecision: { 
    type: String, 
    enum: ['pending', 'yes', 'no'], 
    default: 'pending' 
  },
  u1ReadyForNext: { type: Boolean, default: false },
  u2ReadyForNext: { type: Boolean, default: false }
});

const BlindSession = mongoose.model("BlindSession", BlindSessionSchema);
export default BlindSession;
