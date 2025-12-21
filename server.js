import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";


import usersRoutes from "./routes/usersRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import userOnboardingRoutes from "./routes/userOnboardingRoutes.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'https://unlock-me-frontend.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const isVercelPreview = origin.endsWith('.vercel.app');
    const isAllowed = allowedOrigins.includes(origin);

    if (isAllowed || isVercelPreview) {
      return callback(null, true);
    } else {
      const msg = 'CORS policy: This origin is not allowed.';
      return callback(new Error(msg), false);
    }
  },
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api/users", usersRoutes);
app.use("/api/user", userRoutes);
app.use("/api/user/onboarding", userOnboardingRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected successfully");
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch((err) => console.log("MongoDB connection error:", err));
