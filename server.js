import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import hpp from "hpp";
import morgan from "morgan";
import mongoose from "mongoose";
import connectDB from "./config/db.js"; // ✅ استفاده از کانکشن حرفه‌ای
import redisClient from "./config/redis.js";
import { validateEnv } from "./config/env.js"; // ✅ Critical Fix: Environment validation

// Routes
import usersRoutes from "./routes/usersRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import userOnboardingRoutes from "./routes/userOnboardingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import exploreRoutes from "./routes/exploreRoutes.js";
import matchesRoutes from "./routes/matchesRoutes.js";
import swipeRoutes from "./routes/swipeRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import blindDateRoutes from "./routes/blindDateRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import goDateRoutes from "./routes/goDateRoutes.js";

import { handleSocketConnection } from "./sockets/socketHandler.js";

// ✅ Critical Fix: Validate environment variables before starting
validateEnv();

// ✅ Workers (Background Jobs)
// ✅ Scalability Optimization: Use optimized match worker with Redis
import "./workers/matchWorkerOptimized.js"; // Internal Match Job - runs every 4 hours (with Redis)
import "./workers/redisKeepAliveWorker.js"; // Redis Keep-Alive - runs every 6 hours
import "./workers/arrayCleanupWorker.js"; // Array Cleanup - runs daily at 2 AM

// ✅ اتصال به دیتابیس قبل از هر کاری
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", 1); // حیاتی برای اینکه IP موبایل‌ها درست تشخیص داده شود

const server = http.createServer(app);

// ==========================================
// 1. LOGGING & CORS
// ==========================================
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5000",
  "https://unlock-me-frontend.vercel.app",
  "https://unlock-me.app",
  "https://www.unlock-me.app",
  "http://192.168.8.124:5173",
];

const corsOptions = {
  origin: function (origin, callback) {
    // ✅ Fix 10: Better origin validation
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) {
      // In production, you might want to be stricter
      if (process.env.NODE_ENV === "production") {
        console.warn("⚠️ Request with no origin in production");
        callback(new Error("CORS_ERROR"));
        return;
      }
      callback(null, true);
      return;
    }

    // Check against allowed origins
    if (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
      callback(null, true);
    } else {
      console.error(`🚫 Blocked by CORS: ${origin}`);
      callback(new Error("CORS_ERROR"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// ==========================================
// 2. SECURITY HEADERS & COMPRESSION
// ==========================================
app.use(helmet());
app.use(compression());

// ✅ Security Fix: Better Rate Limiting
// General API rate limiter (less strict)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Reduced from 1000
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Much stricter
  message: "Too many requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", generalLimiter);
// Apply strict limiter to sensitive routes
app.use("/api/user/signin", strictLimiter);
app.use("/api/user/signup", strictLimiter);
app.use("/api/user/forgot-password", strictLimiter);
app.use("/api/user/profile/password", strictLimiter);

// ==========================================
// 3. BODY PARSING
// ==========================================
app.use("/api/webhook", webhookRoutes);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());

// ==========================================
// 4. SUPER SANITIZER (Security + Data Consistency)
// ==========================================
// این تابع هم امنیت (NoSQL Injection) را تامین می‌کند و هم فاصله اضافی (Trim) را حذف می‌کند
const sanitizeRequest = (obj) => {
  if (typeof obj !== "object" || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeRequest(item));
  }

  for (const key in obj) {
    // 1. امنیت: حذف کلیدهایی که با $ شروع می‌شوند
    if (/^\$/.test(key)) {
      delete obj[key];
      continue;
    }

    if (typeof obj[key] === "object") {
      sanitizeRequest(obj[key]);
    }
  }
  return obj;
};

app.use((req, res, next) => {
  if (req.body) sanitizeRequest(req.body);
  if (req.query) sanitizeRequest(req.query);
  if (req.params) sanitizeRequest(req.params);
  next();
});

// جلوگیری از آلودگی پارامترها (مثلا ?sort=asc&sort=desc)
app.use(hpp());

// ==========================================
// 5. SOCKET.IO SETUP
// ==========================================
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

const userSocketMap = new Map();

export const getReceiverSocketId = (receiverId) => {
  return userSocketMap.get(receiverId);
};

io.on("connection", (socket) => {
  handleSocketConnection(io, socket, userSocketMap);
});

// ==========================================
// 6. ROUTES
// ==========================================
app.use("/api/chat", chatRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/user", userRoutes);
app.use("/api/user/onboarding", userOnboardingRoutes);
app.use("/api/user/matches", matchesRoutes);
app.use("/api/explore", exploreRoutes);
app.use("/api/swipe", swipeRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/blind-date", blindDateRoutes);
app.use("/api/go-date", goDateRoutes);

app.get("/ping", (req, res) => {
  res.status(200).send("pong 🏓");
});

// ✅ Critical Fix: Health Check Endpoint for Monitoring
app.get("/health", async (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: "ok",
    checks: {
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      redis: redisClient && redisClient.isOpen ? "connected" : "disconnected",
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
      },
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || "development",
    },
  };

  // Return 503 if database is not connected (for monitoring tools)
  const statusCode = health.checks.database === "connected" ? 200 : 503;
  res.status(statusCode).json(health);
});

// ==========================================
// 7. GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
  if (err.message === "CORS_ERROR") {
    return res.status(403).json({
      success: false,
      message: "CORS Policy Violation: Access Denied.",
    });
  }

  const statusCode = err.statusCode || 500;

  // ✅ Security Fix: Don't expose error details in production
  let message = "Internal Server Error";
  if (process.env.NODE_ENV !== "production") {
    message = err.message || "Internal Server Error";
  } else {
    // In production, only show generic messages
    if (statusCode === 400) {
      message = "Invalid request. Please check your input.";
    } else if (statusCode === 401) {
      message = "Authentication failed.";
    } else if (statusCode === 403) {
      message = "Access denied.";
    } else if (statusCode === 404) {
      message = "Resource not found.";
    } else {
      message = "Server error. Please try again later.";
    }
  }

  // Always log errors server-side
  if (statusCode === 500) {
    console.error("🔥 Server Error:", {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.userId,
    });
  } else {
    console.warn("⚠️ Client Error:", {
      message: err.message,
      statusCode,
      path: req.path,
      method: req.method,
      userId: req.user?.userId,
    });
  }

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// ==========================================
// 8. CRITICAL FIX: Unhandled Error Handlers
// ==========================================
// ✅ Critical Fix: Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 Unhandled Rejection at:", promise);
  console.error("Reason:", reason);
  // Don't exit - log and continue
  // In production, send to error tracking service (Sentry, etc.)
});

// ✅ Critical Fix: Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("🔥 Uncaught Exception:", error);
  // For uncaught exceptions, it's safer to exit gracefully
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// ==========================================
// 9. SERVER START & GRACEFUL SHUTDOWN
// ==========================================
const httpServer = server.listen(PORT, () => {
  console.log(
    `🚀 Server running on port ${PORT} in ${
      process.env.NODE_ENV || "development"
    } mode`
  );
});

// ✅ Critical Fix: Enhanced Graceful Shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  httpServer.close(async () => {
    console.log("✅ HTTP server closed");

    try {
      // Close Socket.io
      io.close(() => {
        console.log("✅ Socket.io closed");
      });

      // Close MongoDB connection
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log("✅ MongoDB connection closed");
      }

      // Close Redis connection
      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        console.log("✅ Redis connection closed");
      }

      console.log("👋 Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error("⚠️ Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

// Handle termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
