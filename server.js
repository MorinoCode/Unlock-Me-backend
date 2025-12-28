import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import usersRoutes from "./routes/usersRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import userOnboardingRoutes from "./routes/userOnboardingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import exploreRoutes from "./routes/exploreRoutes.js"
import matchesRoutes from "./routes/matchesRoutes.js"
import swipeRoutes from "./routes/swipeRoutes.js"
import locationRoutes from "./routes/locationRoutes.js"
import reportRoutes from "./routes/reportRoutes.js"
import { addToQueue } from "./utils/blindDateService.js.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);



const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ["http://localhost:5173", "https://unlock-me-frontend.vercel.app"];
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
      callback(null, true);
    } else {
      callback(new Error("CORS policy violation"), false);
    }
  },
  credentials: true,
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


// Socket.io Setup
const io = new Server(server, { cors: corsOptions });
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("join_room", (userId) => socket.join(userId));
  
  socket.on("typing", ({ receiverId, senderId }) => {
    io.to(receiverId).emit("display_typing", { senderId });
  });

  socket.on("stop_typing", ({ receiverId }) => {
    io.to(receiverId).emit("hide_typing");
  });
  socket.on('join_blind_queue', async (data) => {
    const result = await addToQueue(socket.userId, data.criteria);
    
    if (result.participants) {
      // مچ پیدا شد! هر دو را به یک اتاق وصل کن
      const roomId = `blind_${result._id}`;
      socket.join(roomId);
      io.to(result.participants[0]).emit('match_found', result);
      io.to(result.participants[1]).emit('match_found', result);
    }
  });

  socket.on('submit_blind_answer', async (data) => {
    // صدا کردن تابع submitAnswer از کنترلر و فرستادن فیدبک لحظه‌ای
    // اگر هر دو جواب دادند:
    io.to(`blind_${data.sessionId}`).emit('reveal_answers', data);
  });

  socket.on("disconnect", () => {});
});

// Routes
app.use("/api/chat", chatRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/user", userRoutes);
app.use("/api/user/onboarding", userOnboardingRoutes);
app.use("/api/user/matches", matchesRoutes);
app.use("/api/explore", exploreRoutes);
app.use("/api/swipe", swipeRoutes);
app.use("/api/locations", locationRoutes);
app.use('/api/reports', reportRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log("DB Error:", err));