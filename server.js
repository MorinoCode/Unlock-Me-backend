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
import exploreRoutes from "./routes/exploreRoutes.js";
import matchesRoutes from "./routes/matchesRoutes.js";
import swipeRoutes from "./routes/swipeRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import { addToQueue } from "./utils/blindDateService.js";
import BlindSession from "./models/BlindSession.js";
import BlindQuestion from "./models/BlindQuestion.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Map to store active user IDs and their corresponding socket IDs for notifications
const userSocketMap = new Map(); 

// Exporting this to be used in controllers to find online users
export const getReceiverSocketId = (receiverId) => {
  return userSocketMap.get(receiverId);
};

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "http://localhost:5173",
      "https://unlock-me-frontend.vercel.app",
      "https://unlock-me.app", // Your new professional domain
    ];
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")
    ) {
      callback(null, true);
    } else {
      callback(new Error("CORS policy violation"), false);
    }
  },
  credentials: true,
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://localhost:5173",
        "https://unlock-me-frontend.vercel.app",
        "https://unlock-me.io",
      ];
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

// Attach io to app to access it in routes/controllers via req.app.get("io")
app.set("io", io);

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  
  if (userId && userId !== "undefined") {
    socket.userId = userId; // حتماً ذخیره شود برای دیسکانکت
    socket.join(userId); 
    userSocketMap.set(userId, socket.id); // اضافه کردن به مپ به محض اتصال
    console.log(`User ${userId} connected and joined room.`);
  }

  // این ایونت را نگه دارید اما منطق تکراری را حذف کنید
  socket.on("join_room", (id) => {
    if (!socket.userId) {
      socket.userId = id;
      socket.join(id);
      userSocketMap.set(id, socket.id);
      console.log(`User ${id} joined via join_room.`);
    }
  });

  // Chat typing events
  socket.on("typing", ({ receiverId, senderId }) => {
    io.to(receiverId).emit("display_typing", { senderId });
  });

  socket.on("stop_typing", ({ receiverId }) => {
    io.to(receiverId).emit("hide_typing");
  });

  // Blind Date logic preserved and untouched
  socket.on("join_blind_queue", async (data) => {
    const currentUserId = socket.userId || data.userId;
    if (!currentUserId) return;

    const result = await addToQueue(currentUserId, data.criteria);
    if (result.status === "matched") {
      const session = result.session;
      const roomId = `blind_${session._id}`;
      socket.join(roomId);
      io.to(session.participants[0]._id.toString()).emit("match_found", session);
      io.to(session.participants[1]._id.toString()).emit("match_found", session);
    }
  });

  socket.on('submit_blind_answer', async ({ sessionId, choiceIndex }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;

      const isUser1 = session.participants[0].toString() === socket.userId;
      const isUser2 = session.participants[1].toString() === socket.userId;

      const currentQ = session.questions[session.currentQuestionIndex];
      if (isUser1 && currentQ.u1Answer === null) currentQ.u1Answer = choiceIndex;
      else if (isUser2 && currentQ.u2Answer === null) currentQ.u2Answer = choiceIndex;

      if (currentQ.u1Answer !== null && currentQ.u2Answer !== null) {
        if (session.currentQuestionIndex < 4) session.currentQuestionIndex += 1;
        else session.status = 'waiting_for_stage_2';
      }

      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      
      const roomId = `blind_${sessionId}`;
      io.to(roomId).emit('session_update', updatedSession);
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
    } catch (err) { console.error(err); }
  });

  socket.on('proceed_to_next_stage', async ({ sessionId }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;
      const isUser1 = session.participants[0].toString() === socket.userId;
      if (isUser1) session.u1ReadyForNext = true;
      else session.u2ReadyForNext = true;

      if (session.u1ReadyForNext && session.u2ReadyForNext) {
        session.currentStage += 1;
        session.status = 'active';
        session.currentQuestionIndex = 0;
        session.u1ReadyForNext = false;
        session.u2ReadyForNext = false;

        const nextQuestions = await BlindQuestion.aggregate([{ $match: { stage: session.currentStage } }, { $sample: { size: 5 } }]);
        if (nextQuestions.length > 0) {
          session.questions = nextQuestions.map(q => ({ questionId: q._id, u1Answer: null, u2Answer: null }));
        }
      }
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
    } catch (err) { console.error(err); }
  });

  socket.on('send_blind_message', async ({ sessionId, text }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session || session.status !== 'active') return;
      session.messages.push({ sender: socket.userId, text, createdAt: new Date() });
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
    } catch (err) { console.error(err); }
  });

  socket.on('submit_reveal_decision', async ({ sessionId, decision }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;
      if (session.participants[0].toString() === socket.userId) session.u1RevealDecision = decision;
      else session.u2RevealDecision = decision;
      if (session.u1RevealDecision !== 'pending' && session.u2RevealDecision !== 'pending') session.status = 'completed';
      await session.save();
      const updatedSession = await BlindSession.findById(sessionId).populate('participants', 'name avatar').populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
    } catch (err) { console.error(err); }
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      userSocketMap.delete(socket.userId); // Cleanup online users map
      console.log(`User ${socket.userId} disconnected.`);
    }
  });
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
app.use("/api/reports", reportRoutes);
app.use('/api/posts', postRoutes);
app.use("/api/notifications", notificationRoutes);

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log("DB Error:", err));