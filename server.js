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
import jwt from "jsonwebtoken"; // ✅ Security Fix: For socket authentication
import * as cookie from "cookie"; // ✅ Security Fix: For parsing socket cookies

// Routes
import usersRoutes from "./routes/usersRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import userOnboardingRoutes from "./routes/userOnboardingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import exploreRoutes from "./routes/exploreRoutes.js";
import matchesRoutes from "./routes/matchesRoutes.js";
import unlockRoutes from "./routes/unlockRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import blindDateRoutes from "./routes/blindDateRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import goDateRoutes from "./routes/goDateRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import adminRoutes from "./routes/adminRoutes.js"; // ✅ NEW: Isolated Admin Routes
import seoRoutes from "./routes/seoRoutes.js"; // ✅ NEW: Dynamic Sitemap Generation

import { handleSocketConnection } from "./sockets/socketHandler.js";

// ✅ Critical Fix: Validate environment variables before starting
validateEnv();

// ✅ Workers (Background Jobs)
import "./workers/unlockFeedWorker.js"; // unlock Feed Worker - runs every 6 hours
// matchWorker.js is now on-demand only (no cron) - triggered via generateAnalysisData()
import "./workers/redisKeepAliveWorker.js"; // Redis Keep-Alive - runs every 6 hours
import "./workers/arrayCleanupWorker.js"; // Array Cleanup - runs daily at 2 AM
import "./workers/trialExpirationWorker.js"; // ✅ Trial Expiration - runs every hour
import "./workers/analysisQueueWorker.js"; // ✅ NEW: BullMQ Analysis Worker
import "./workers/goDateWorker.js"; // ✅ Enterprise GoDate Worker
import "./workers/goDateCleanupCron.js"; // ✅ Enterprise GoDate Cleanup scheduler
import "./workers/unlockWorker.js"; // ✅ NEW: High-Scale unlock Worker
import "./workers/notificationWorker.js"; // ✅ NEW: Enterprise Notification Worker
import "./workers/mediaWorker.js"; // ✅ NEW: Enterprise Media Worker
import "./workers/onboardingWorker.js"; // ✅ NEW: Enterprise Onboarding Worker
import "./workers/revenueCatWorker.js"; // ✅ NEW: Async RevenueCat Webhook Processor


import { Worker } from "worker_threads";

// ✅ Start Explore Worker (Background Thread)
if (process.env.NODE_ENV !== 'test') {
  new Worker(new URL("./workers/exploreWorker.js", import.meta.url), {
    env: process.env
  });
}

// ✅ اتصال به دیتابیس قبل از هر کاری
connectDB();

// ✅ Setup Redis Pub/Sub for Worker Notifications
const setupRedisSubscriber = async () => {
  const subscriber = redisClient.duplicate();
  await subscriber.connect();
  
  await subscriber.subscribe("job-events", (message) => {
    try {
      const event = JSON.parse(message);
      const io = app.get("io");
      
      if (io && event.userId) {
        if (event.type === 'ANALYSIS_COMPLETE') {
          console.log(`🔔 [Socket] Notifying user ${event.userId}: Analysis Complete`);
          io.to(event.userId).emit("analysis_complete", { 
            ready: true, 
            duration: event.duration 
          });
        } else if (event.type === 'EXPLORE_COMPLETE') {
          console.log(`🔔 [Socket] Notifying user ${event.userId}: Explore Complete`);
          io.to(event.userId).emit("explore_complete", { 
            success: true 
          });
        } else if (event.type === 'unlock_FEED_COMPLETE') {
          console.log(`🔔 [Socket] Notifying user ${event.userId}: unlock Feed Complete`);
          io.to(event.userId).emit("unlock_feed_complete", { 
            success: true 
          });
        } else if (event.type === 'ANALYSIS_FAILED') {
          console.log(`🔔 [Socket] Notifying user ${event.userId}: Analysis Failed`);
          io.to(event.userId).emit("analysis_error", { 
            message: event.error 
          });
        } else if (event.type === 'NEW_NOTIFICATION') {
          console.log(`🔔 [Socket] Emit Notification to user ${event.userId}`);
          io.to(event.userId).emit("new_notification", event.notification);
        } else if (event.type === 'MEDIA_PROCESSED') {
          console.log(`🖼️ [Socket] Emit Media Processed to user ${event.userId}`);
          io.to(event.userId).emit("media_processed", {
            mediaType: event.mediaType,
            payload: event.payload
          });
        } else if (event.type === 'MEDIA_REJECTED') {
          console.log(`⚠️ [Socket] Emit Media REJECTED to user ${event.userId}`);
          io.to(event.userId).emit("media_rejected", {
            mediaType: event.mediaType,
            reason: event.reason,
            notes: event.notes
          });
        } else if (event.type === 'ONBOARDING_PROCESSED') {
          console.log(`🧬 [Socket] Emit Onboarding Processed to user ${event.userId}`);
          io.to(event.userId).emit("onboarding_processed", event.payload);
        }
      }
    } catch (err) {
      console.error("❌ Redis Pub/Sub Error:", err);
    }
  });
  console.log("✅ [Server] Listening for Job Events...");
};

setupRedisSubscriber();

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
  "http://localhost:5174", // ✅ NEW: Admin Panel
  "http://localhost:5000",
  "https://unlock-me-frontend.vercel.app",
  "https://unlock-me.app",
  "https://www.unlock-me.app",
  "http://192.168.8.124:5173",
  "https://localhost",          // ✅ Critical Fix: For Android Capacitor
  "http://localhost",           // ✅ For Android Emulators
  "capacitor://localhost"
];

const corsOptions = {
  origin: function (origin, callback) {
    // ✅ Security Fix #13: Allow requests with no origin (mobile apps, React Native, cURL)
    if (!origin) {
      callback(null, true);
      return;
    }

    // ✅ Security Fix #10: Removed wildcard *.vercel.app — only allow specific origins
    if (allowedOrigins.includes(origin)) {
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
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        mediaSrc: ["'self'", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://res.cloudinary.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);
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
// ✅ Improvement #23: Rate limiting for block/unblock endpoints
app.use("/api/user/block", strictLimiter);
app.use("/api/user/unblock", strictLimiter);

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
    // 1. امنیت: حذف کلیدهایی که با $ شروع می‌شوند و جلوگیری از Prototype Pollution
    if (/^\$/.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
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
      // ✅ Security Fix #10: Same restricted CORS for Socket.IO
      if (
        !origin ||
        allowedOrigins.includes(origin)
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

// ✅ Redis Adapter Setup for Horizontal Scaling
// This allows multiple server instances to broadcast events to each other.
const setupSocketRedisAdapter = async () => {
  try {
    const { createAdapter } = await import("@socket.io/redis-adapter");
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    console.log("✅ [Socket.IO] Redis Adapter connected (Multi-Server Ready)");
  } catch (err) {
    console.error("❌ [Socket.IO] Redis Adapter Failed:", err);
  }
};

setupSocketRedisAdapter();

app.set("io", io);

const userSocketMap = new Map();

export const getReceiverSocketId = (receiverId) => {
  return userSocketMap.get(receiverId);
};

// ✅ Security Fix #9: Socket authentication middleware
io.use((socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie;
    if (!rawCookies) {
      return next(new Error("Authentication required"));
    }
    const cookies = cookie.parse(rawCookies);
    const token = cookies["unlock-me-token"] || cookies["unlock-me-refresh-token"];
    if (!token) {
      return next(new Error("Authentication required"));
    }
    // Try access token first, then refresh token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // If access token failed, try refresh token secret
      const refreshToken = cookies["unlock-me-refresh-token"];
      if (refreshToken) {
        // Fallback to refresh token if no access token
        const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
        decoded = jwt.verify(refreshToken, refreshSecret);
      } else {
        return next(new Error("Invalid token"));
      }
    }
    socket.userId = decoded.userId?.toString();
    socket.handshake.query.userId = socket.userId;
    next();
  } catch (err) {
    console.error("Socket auth error:", err.message);
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  try {
    handleSocketConnection(io, socket, userSocketMap);

    // ✅ Crash-proofing: Catch all socket errors
    socket.on("error", (err) => {
      console.error(`🔥 [Socket] Internal Error for User ${socket.userId || 'Unknown'}:`, err.message);
    });
  } catch (err) {
    console.error("🔥 [Socket] Fatal Connection Setup Error:", err);
  }
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
app.use("/api/unlock", unlockRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/webhooks", webhookRoutes); // ✅ Standardized Webhooks
app.use("/api/payment", paymentRoutes);
app.use("/api/blind-date", blindDateRoutes);
app.use("/api/go-date", goDateRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/seo", seoRoutes); // ✅ NEW: Admin endpoints

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
// eslint-disable-next-line no-unused-vars -- Express requires 4-arg signature for error middleware
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
