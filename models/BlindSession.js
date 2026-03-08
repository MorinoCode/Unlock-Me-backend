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
      "instructions",
      "active",
      "waiting_for_stage_2",
      "waiting_for_stage_3",
      "waiting_for_reveal",
      "completed",
      "cancelled",
    ],
    default: "instructions",
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
    u1InstructionRead: { type: Boolean, default: false },
    u2InstructionRead: { type: Boolean, default: false },
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

BlindSessionSchema.index({ participants: 1, status: 1 });
BlindSessionSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { status: { $in: ["cancelled", "expired"] } } }
);

const BlindSession = mongoose.model("BlindSession", BlindSessionSchema);
export default BlindSession;
