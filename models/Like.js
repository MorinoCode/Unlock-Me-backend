import mongoose from "mongoose";

const likeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["Post", "Comment"],
      required: true,
    },
  },
  { timestamps: true }
);

// Ensure a user can only like a specific target once
likeSchema.index({ targetId: 1, user: 1 }, { unique: true });

const Like = mongoose.model("Like", likeSchema);
export default Like;
