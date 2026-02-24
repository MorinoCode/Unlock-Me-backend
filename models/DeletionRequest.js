import mongoose from "mongoose";

const deletionRequestSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    trim: true,
  },
  identifierType: {
    type: String,
    enum: ["email", "username"],
    default: "email",
  },
  reason: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ["pending", "processed", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  processedAt: {
    type: Date,
  }
});

const DeletionRequest = mongoose.model("DeletionRequest", deletionRequestSchema);

export default DeletionRequest;
