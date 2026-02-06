import mongoose from "mongoose";

const goDateApplySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    dateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoDate",
      required: true,
    },
  },
  { timestamps: true }
);

goDateApplySchema.index({ userId: 1, dateId: 1 }, { unique: true });
goDateApplySchema.index({ userId: 1, createdAt: -1 });

const GoDateApply = mongoose.model("GoDateApply", goDateApplySchema);
export default GoDateApply;
