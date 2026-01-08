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
import webhookRoutes from "./routes/webhookRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import { addToQueue } from "./utils/blindDateService.js";
import BlindSession from "./models/BlindSession.js";
import BlindQuestion from "./models/BlindQuestion.js";
import "./workers/matchWorker.js";

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
      "https://unlock-me.app",      // دامین اصلی
      "https://www.unlock-me.app",  // ساب‌دامین www (محض اطمینان)
    ];
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")
    ) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin); // لاگ برای دیباگ
      callback(new Error("CORS policy violation"), false);
    }
  },
  credentials: true,
};

app.use('/api/webhook', webhookRoutes);

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
        "https://unlock-me.app",
        "https://www.unlock-me.app",
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

  socket.on('confirm_instructions', async ({ sessionId }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;

      const isUser1 = session.participants[0].toString() === socket.userId;
      
      if (isUser1) session.stageProgress.u1InstructionRead = true;
      else session.stageProgress.u2InstructionRead = true;

      // اگر هر دو نفر تایید کردند، بازی شروع شود
      if (session.stageProgress.u1InstructionRead && session.stageProgress.u2InstructionRead) {
        session.status = 'active'; // تغییر وضعیت به اکتیو
        session.currentStage = 1;
      }

      await session.save();
      
      // آپدیت برای هر دو طرف
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
      
    } catch (err) { console.error(err); }
  });

  // این ایونت را نگه دارید اما منطق تکراری را حذف کنید
  socket.on("join_room", (id) => {
    if (!socket.userId) {
      socket.userId = id;
      socket.join(id);
      userSocketMap.set(id, socket.id);
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

  // ✅ FIX: لاجیک این قسمت کاملاً اصلاح شد تا برای مرحله ۲ هم کار کند
  socket.on('submit_blind_answer', async ({ sessionId, choiceIndex }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;

      const isUser1 = session.participants[0].toString() === socket.userId;
      const isUser2 = session.participants[1].toString() === socket.userId;

      const currentQ = session.questions[session.currentQuestionIndex];
      
      // ثبت جواب
      if (isUser1 && currentQ.u1Answer === null) currentQ.u1Answer = choiceIndex;
      else if (isUser2 && currentQ.u2Answer === null) currentQ.u2Answer = choiceIndex;

      // بررسی اینکه آیا هر دو نفر جواب داده‌اند؟
      if (currentQ.u1Answer !== null && currentQ.u2Answer !== null) {
        
        // محاسبه حد نهایی سوالات فعلی
        // اگر استیج ۱ باشیم، طول آرایه ۵ است (ایندکس ۰ تا ۴)
        // اگر استیج ۲ باشیم، طول آرایه ۱۰ شده است (ایندکس ۰ تا ۹)
        const maxIndex = session.questions.length - 1;

        if (session.currentQuestionIndex < maxIndex) {
            // هنوز سوال باقی مانده، برو بعدی
            session.currentQuestionIndex += 1;
        } else {
            // سوالات تمام شده، برو به ویتینگ روم مربوطه
            if (session.currentStage === 1) {
                session.status = 'waiting_for_stage_2';
            } else if (session.currentStage === 2) {
                session.status = 'waiting_for_stage_3';
            }
        }
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
      
      if (isUser1) session.stageProgress.u1ReadyNext = true;
      else session.stageProgress.u2ReadyNext = true;

      // بررسی اینکه آیا هر دو نفر آماده هستند؟
      if (session.stageProgress.u1ReadyNext && session.stageProgress.u2ReadyNext) {
        
        session.currentStage += 1;
        session.status = 'active';
        
        // ✅ FIX: ایندکس را یکی جلو می‌بریم تا از سوال آخرِ مرحله قبل، بپرد روی سوال اولِ مرحله جدید
        // مثال: مرحله ۱ روی ایندکس ۴ تمام شد. الان می‌شود ۵ (شروع مرحله ۲)
        session.currentQuestionIndex += 1;
        
        session.stageProgress.u1ReadyNext = false;
        session.stageProgress.u2ReadyNext = false;

        // اگر وارد مرحله ۲ شدیم، سوالات مرحله ۲ را لود کن و به ته لیست اضافه کن
        if (session.currentStage === 2) {
           const nextQuestions = await BlindQuestion.aggregate([
              { $match: { stage: 2 } }, 
              { $sample: { size: 5 } }
           ]);
           
           const newQs = nextQuestions.map(q => ({
              questionId: q._id,
              u1Answer: null, // این‌ها نال هستند و قفل نمی‌شوند
              u2Answer: null
           }));
           
           session.questions.push(...newQs);
        }
      }

      await session.save();
      
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
      
    } catch (err) { console.error("Proceed Error:", err); }
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

      // 1. ثبت تصمیم کاربر
      if (session.participants[0].toString() === socket.userId) {
         session.u1RevealDecision = decision;
      } else {
         session.u2RevealDecision = decision;
      }

      // 2. بررسی اینکه آیا هر دو نفر تصمیم گرفته‌اند؟
      if (session.u1RevealDecision !== 'pending' && session.u2RevealDecision !== 'pending') {
        
        // ✅ FIX: لاجیک شرطی برای موفقیت یا شکست
        if (session.u1RevealDecision === 'yes' && session.u2RevealDecision === 'yes') {
            // هر دو بله گفتند -> موفقیت
            session.status = 'completed'; 
        } else {
            // حداقل یک نفر نه گفته -> شکست
            session.status = 'cancelled';
        }
      }

      await session.save();
      
      // آپدیت برای فرانت‌اند (با populate کردن شرکت‌کننده‌ها برای حالت completed)
      const updatedSession = await BlindSession.findById(sessionId)
        .populate('participants', 'name avatar') // فقط اگر completed باشد این‌ها دیده می‌شوند
        .populate('questions.questionId');

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
app.use('/api/payment', paymentRoutes);
app.get("/ping", (req, res) => {
  res.status(200).send("pong 🏓");
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log("DB Error:", err));