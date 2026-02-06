import mongoose from "mongoose";

const goDateSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  category: {
    type: String,
    enum: ["coffee", "food", "drink", "movie", "activity", "other"],
    default: "coffee",
  },
  title: { type: String, required: true },
  description: { type: String, maxlength: 500 },
  dateTime: { type: Date, required: true },
  location: {
    city: { type: String, required: true },
    generalArea: { type: String, required: true },
    exactAddress: { type: String, required: true },
    coordinates: {
      lat: Number,
      lng: Number,
    },
  },
  image: { type: String, default: "" },
  imageId: { type: String, default: "" },
  paymentType: {
    type: String,
    enum: ["me", "you", "split"],
    default: "split",
  },
  preferences: {
    // ✅ اصلاح شده: 'all' حذف شد و 'other' اضافه شد
    gender: {
      type: String,
      enum: ["male", "female", "other"],
      default: "other",
    },
    minAge: { type: Number, default: 18 },
    maxAge: { type: Number, default: 99 },
  },
  applicants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  acceptedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  status: {
    type: String,
    enum: ["open", "closed", "expired", "cancelled"],
    default: "open",
  },
  createdAt: { type: Date, default: Date.now },
});

goDateSchema.index({ "location.city": 1, dateTime: 1 });

const GoDate = mongoose.model("GoDate", goDateSchema);
export default GoDate;
