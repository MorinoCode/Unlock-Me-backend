import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import redisClient from "./config/redis.js";
import { validateEnv } from "./config/env.js";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import logger from "./utils/logger.js";
import { unifiedSanitizer } from "./middleware/security.js";
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
import adminRoutes from "./routes/adminRoutes.js";
import seoRoutes from "./routes/seoRoutes.js";
import { handleSocketConnection } from "./sockets/socketHandler.js";

validateEnv();
import unlockFeedWorker from "./workers/unlockFeedWorker.js";
import "./workers/redisKeepAliveWorker.js";
import arrayCleanupProducer from "./workers/arrayCleanupProducer.js";
import arrayCleanupConsumer from "./workers/arrayCleanupConsumer.js";

import soulmateProducer from "./workers/soulmateProducer.js";
import soulmateConsumer from "./workers/soulmateConsumer.js";
import analysisQueueWorker from "./workers/analysisQueueWorker.js";
import goDateWorker from "./workers/goDateWorker.js";
import unlockWorker from "./workers/unlockWorker.js";
import notificationWorker from "./workers/notificationWorker.js";
import mediaWorker from "./workers/mediaWorker.js";
import onboardingWorker from "./workers/onboardingWorker.js";
import revenueCatWorker from "./workers/revenueCatWorker.js";
import messageWorker from "./workers/messageWorker.js";
import { Worker } from "worker_threads";
const bullMQWorkers = [
  unlockFeedWorker,
  arrayCleanupProducer,
  arrayCleanupConsumer,

  soulmateProducer,
  soulmateConsumer,
  analysisQueueWorker,
  goDateWorker,
  unlockWorker,
  notificationWorker,
  mediaWorker,
  onboardingWorker,
  revenueCatWorker,
  messageWorker
].filter(w => w && typeof w.close === "function");
if (process.env.NODE_ENV !== "test") {
  new Worker(new URL("./workers/exploreWorker.js", import.meta.url), {
    env: process.env
  });
}
connectDB();
const setupRedisSubscriber = async () => {
  const subscriber = redisClient.duplicate();
  await subscriber.connect();
  await subscriber.subscribe("job-events", (message) => {
    try {
      const event = JSON.parse(message);
      const io = app.get("io");
      if (io && event.userId) {
        if (event.type === "ANALYSIS_COMPLETE") {
          io.to(event.userId).emit("analysis_complete", {
            ready: true,
            duration: event.duration
          });
        } else if (event.type === "EXPLORE_COMPLETE") {
          io.to(event.userId).emit("explore_complete", {
            success: true
          });
        } else if (event.type === "unlock_FEED_COMPLETE") {
          io.to(event.userId).emit("unlock_feed_complete", {
            success: true
          });
        } else if (event.type === "ANALYSIS_FAILED") {
          io.to(event.userId).emit("analysis_error", {
            message: event.error
          });
        } else if (event.type === "NEW_NOTIFICATION") {
          io.to(event.userId).emit("new_notification", event.notification);
        } else if (event.type === "MEDIA_PROCESSED") {
          io.to(event.userId).emit("media_processed", {
            mediaType: event.mediaType,
            payload: event.payload
          });
        } else if (event.type === "MEDIA_REJECTED") {
          io.to(event.userId).emit("media_rejected", {
            mediaType: event.mediaType,
            reason: event.reason,
            notes: event.notes
          });
        } else if (event.type === "ONBOARDING_PROCESSED") {
          io.to(event.userId).emit("onboarding_processed", event.payload);
        } else if (event.type === "NEW_CHAT_MESSAGE") {
          io.to(event.receiverId).emit("receive_message", event.message);
        }
      }
    } catch (err) {
      logger.error({ err }, "Redis subscriber parsing error");
    }
  });
};
setupRedisSubscriber();
const app = express();
const PORT = process.env.PORT || 5000;
app.set("trust proxy", 1);
const server = http.createServer(app);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5000",
  "https://unlock-me-frontend.vercel.app",
  "https://unlock-me.app",
  "https://www.unlock-me.app",
  "http://192.168.8.124:5173",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost"
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS_ERROR"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-app-platform"],
};
app.use(cors(corsOptions));
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
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalLimiter);
app.use("/api/user/signin", strictLimiter);
app.use("/api/user/signup", strictLimiter);
app.use("/api/user/forgot-password", strictLimiter);
app.use("/api/user/profile/password", strictLimiter);
app.use("/api/user/block", strictLimiter);
app.use("/api/user/unblock", strictLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(unifiedSanitizer);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const setupSocketRedisAdapter = async () => {
  try {
    const { createAdapter } = await import("@socket.io/redis-adapter");
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
  } catch (err) {
    logger.error({ err }, "Redis adapter initialization failed");
  }
};
setupSocketRedisAdapter();
app.set("io", io);
io.use((socket, next) => {
  try {
    let token = socket.handshake.auth?.token;
    if (!token && socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies["unlock-me-token"];
    }
    if (!token && socket.handshake.headers["authorization"]) {
      const authHeader = socket.handshake.headers["authorization"];
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }
    if (!token) return next(new Error("Authentication error"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded._id?.toString() || decoded.userId?.toString() || decoded.id?.toString();
    if (!socket.userId) return next(new Error("Authentication error"));
    next();
  } catch {
    return next(new Error("Authentication error"));
  }
});io.on("connection", (socket) => {
  try {
    if (socket.userId) {
      socket.join(socket.userId);
    }
    handleSocketConnection(io, socket);    socket.on("error", (err) => {      logger.error({ err: err.message }, "Socket error");    });  } catch (err) {    logger.error({ err }, "Socket connection handler error");  }});app.use("/api/chat", chatRoutes);app.use("/api/users", usersRoutes);app.use("/api/user", userRoutes);app.use("/api/user/onboarding", userOnboardingRoutes);app.use("/api/user/matches", matchesRoutes);app.use("/api/explore", exploreRoutes);app.use("/api/unlock", unlockRoutes);app.use("/api/locations", locationRoutes);app.use("/api/reports", reportRoutes);app.use("/api/posts", postRoutes);app.use("/api/blind-date", blindDateRoutes);app.use("/api/notifications", notificationRoutes);app.use("/api/webhooks", webhookRoutes);app.use("/api/payment", paymentRoutes);app.use("/api/go-date", goDateRoutes);app.use("/api/contact", contactRoutes);app.use("/api/admin", adminRoutes);app.use("/api/seo", seoRoutes);app.get("/ping", (req, res) => {  res.status(200).send("pong \uD83C\uDFD3");});app.get("/health", async (req, res) => {  const health = {    uptime: process.uptime(),    timestamp: Date.now(),    status: "ok",    checks: {      database:        mongoose.connection.readyState === 1 ? "connected" : "disconnected",      redis: redisClient && redisClient.isOpen ? "connected" : "disconnected",      memory: {        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",      },      nodeVersion: process.version,      environment: process.env.NODE_ENV || "development",    },  };  const statusCode = health.checks.database === "connected" ? 200 : 503;  res.status(statusCode).json(health);});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {   if (err.message === "CORS_ERROR") {    return res.status(403).json({      success: false,      message: "CORS Policy Violation: Access Denied.",    });  }  const statusCode = err.statusCode || 500;  let message = "Internal Server Error";  if (process.env.NODE_ENV !== "production") {    message = err.message || "Internal Server Error";  } else {    if (statusCode === 400) {      message = "Invalid request. Please check your input.";    } else if (statusCode === 401) {      message = "Authentication failed.";    } else if (statusCode === 403) {      message = "Access denied.";    } else if (statusCode === 404) {      message = "Resource not found.";    } else {      message = "Server error. Please try again later.";
    }  }  res.status(statusCode).json({    success: false,    message: message,    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),  });});process.on("unhandledRejection", (reason, promise) => {  logger.fatal({ reason, promise }, "Unhandled Promise Rejection");  gracefulShutdown("UNHANDLED_REJECTION");});const NON_FATAL_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]);process.on("uncaughtException", (error) => {  if (NON_FATAL_CODES.has(error.code)) {    return;  }  logger.fatal({ error }, "Uncaught Exception");  gracefulShutdown("UNCAUGHT_EXCEPTION");});const httpServer = server.listen(PORT, () => {  logger.info(`Server running on port ${PORT}`);});const gracefulShutdown = async (signal) => {  logger.info({ signal }, "Initiating graceful shutdown");  httpServer.close(async () => {    try {      if (bullMQWorkers.length > 0) {        await Promise.all(bullMQWorkers.map(w => w.close()));      }      io.close(() => {      });      if (mongoose.connection.readyState === 1) {        await mongoose.connection.close();      }      if (redisClient && redisClient.isOpen) {        await redisClient.quit();      }      logger.info("Graceful shutdown completed");      process.exit(signal === "UNHANDLED_REJECTION" || signal === "UNCAUGHT_EXCEPTION" ? 1 : 0);    } catch (error) {      logger.error({ error }, "Error during graceful shutdown");      process.exit(1);    }  });  setTimeout(() => {    logger.fatal("Forcing process exit after timeout");    process.exit(1);  }, 10000);};process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));process.on("SIGINT", () => gracefulShutdown("SIGINT"));