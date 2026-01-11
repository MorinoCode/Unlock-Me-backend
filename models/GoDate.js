import mongoose from "mongoose";

const goDateSchema = new mongoose.Schema({
  creator: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  
  // جزئیات دیت
  category: { 
    type: String, 
    enum: ['coffee', 'food', 'drink', 'movie', 'activity', 'other'], 
    default: 'coffee' 
  },
  title: { type: String, required: true }, // مثلا: "کافه گردی در مرکز شهر"
  description: { type: String, maxlength: 500 },
  
  // زمان دیت
  dateTime: { type: Date, required: true },
  
  // مکان (بخش حساس)
  location: {
    city: { type: String, required: true }, // برای فیلتر کردن
    generalArea: { type: String, required: true }, // "ونک"، "تجریش" (عمومی)
    exactAddress: { type: String, required: true }, // "خیابان فلان پلاک ۱" (خصوصی)
    coordinates: { // اختیاری برای نقشه
       lat: Number,
       lng: Number
    }
  },

  // عکس (اختیاری)
  image: { type: String, default: "" },

  // شرایط
  paymentType: { 
    type: String, 
    enum: ['me', 'you', 'split'], 
    default: 'split' 
  },
  preferences: {
    gender: { type: String, enum: ['male', 'female', 'all'], default: 'all' },
    minAge: { type: Number, default: 18 },
    maxAge: { type: Number, default: 99 }
  },

  // وضعیت درخواست‌ها
  applicants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  }],
  
  acceptedUser: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    default: null
  },

  status: { 
    type: String, 
    enum: ['open', 'closed', 'expired', 'completed'], 
    default: 'open' 
  },

  createdAt: { type: Date, default: Date.now }
});

// ایندکس برای جستجوی سریع‌تر بر اساس شهر و تاریخ
goDateSchema.index({ "location.city": 1, dateTime: 1 });

const GoDate = mongoose.model("GoDate", goDateSchema);
export default GoDate;