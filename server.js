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
import { addToQueue } from "./utils/blindDateService.js.js";
import BlindSession from "./models/BlindSession.js";
import BlindQuestion from "./models/BlindQuestion.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "http://localhost:5173",
      "https://unlock-me-frontend.vercel.app",
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
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("join_room", (userId) => {
    socket.join(userId);
    socket.userId = userId; // ذخیره آیدی در سوکت برای استفاده‌های بعدی
  });

  socket.on("typing", ({ receiverId, senderId }) => {
    io.to(receiverId).emit("display_typing", { senderId });
  });

  socket.on("stop_typing", ({ receiverId }) => {
    io.to(receiverId).emit("hide_typing");
  });
  socket.on("join_blind_queue", async (data) => {
    console.log("Incoming join_blind_queue request from:", socket.userId);
    console.log("Data received:", data);
    const currentUserId = socket.userId || data.userId;

    if (!currentUserId) {
      console.error("Connection Error: No UserID found");
      return;
    }

    const result = await addToQueue(currentUserId, data.criteria);
    console.log("Queue result:", result.status);

    // هماهنگی با خروجی جدید سرویس (matched)
    if (result.status === "matched") {
      const session = result.session;
      const roomId = `blind_${session._id}`;

      // هر دو کاربر را در یک اتاق سوکت عضو کن
      socket.join(roomId);
      // نکته: پارتنر باید در کلاینت خودش به این اتاق جوین شود یا از آیدی شخصی او استفاده کنیم

      io.to(session.participants[0]._id.toString()).emit(
        "match_found",
        session
      );
      io.to(session.participants[1]._id.toString()).emit(
        "match_found",
        session
      );
    }
  });

  socket.on('submit_blind_answer', async ({ sessionId, choiceIndex }) => {
  try {
    console.log(`--- New Answer Received ---`);
    console.log(`Session: ${sessionId} | User: ${socket.userId} | Choice: ${choiceIndex}`);

    const session = await BlindSession.findById(sessionId);
    if (!session) {
        console.error("Session not found in DB");
        return;
    }

    // تشخیص اینکه کاربر فعلی نفر اول است یا دوم
    const isUser1 = session.participants[0].toString() === socket.userId;
    const isUser2 = session.participants[1].toString() === socket.userId;

    if (!isUser1 && !isUser2) {
        console.error("User is not a participant in this session");
        return;
    }

    const currentQ = session.questions[session.currentQuestionIndex];

    // جلوگیری از تغییر جواب قبلی
    if (isUser1 && currentQ.u1Answer === null) {
      currentQ.u1Answer = choiceIndex;
      console.log("User 1 answer saved");
    } else if (isUser2 && currentQ.u2Answer === null) {
      currentQ.u2Answer = choiceIndex;
      console.log("User 2 answer saved");
    }

    // اگر هر دو جواب دادند، وضعیت را بررسی کن
    if (currentQ.u1Answer !== null && currentQ.u2Answer !== null) {
      console.log("Both answered. Moving forward...");
      if (session.currentQuestionIndex < 4) {
        session.currentQuestionIndex += 1;
      } else {
        session.status = 'waiting_for_stage_2';
      }
    }

    await session.save();

    // فرستادن نسخه آپدیت شده همراه با دیتای سوالات
    const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
    
    // ارسال به اتاق مخصوص این سشن
    const roomId = `blind_${sessionId}`;
    io.to(roomId).emit('session_update', updatedSession);
    
    // اطمینان از ارسال به آیدی شخصی (اگر اتاق هنوز ساخته نشده)
    io.to(session.participants[0].toString()).emit('session_update', updatedSession);
    io.to(session.participants[1].toString()).emit('session_update', updatedSession);

    console.log("Updates sent to clients");

  } catch (err) {
    console.error("Error in submit_blind_answer:", err);
  }
});
socket.on('proceed_to_next_stage', async ({ sessionId }) => {
  try {
    const session = await BlindSession.findById(sessionId);
    if (!session) return;

    // پیدا کردن یوزری که کلیک کرده
    const isUser1 = session.participants[0].toString() === socket.userId;
    
    // ثبت آمادگی کاربر برای مرحله بعد
    if (isUser1) {
      session.u1ReadyForNext = true;
    } else {
      session.u2ReadyForNext = true;
    }

    // اگر هر دو نفر آماده بودند، سشن را به مرحله بعد ببر
    if (session.u1ReadyForNext && session.u2ReadyForNext) {
      session.currentStage += 1;
      session.status = 'active'; // برگرداندن به حالت فعال برای مرحله جدید
      session.currentQuestionIndex = 0; // ریست کردن ایندکس سوالات برای مرحله ۲
      
      // ریست کردن آمادگی برای مراحل بعدی
      session.u1ReadyForNext = false;
      session.u2ReadyForNext = false;

      // در اینجا می‌توانید سوالات مرحله ۲ را هم اگر متفاوت هستند جایگزین کنید
      const nextQuestions = await BlindQuestion.aggregate([
        { $match: { stage: session.currentStage } },
        { $sample: { size: 5 } }
      ]);
      
      if (nextQuestions.length > 0) {
        session.questions = nextQuestions.map(q => ({
          questionId: q._id,
          u1Answer: null,
          u2Answer: null
        }));
      }
    }

    await session.save();
    const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
    
    // ارسال آپدیت به هر دو نفر
    io.to(session.participants[0].toString()).emit('session_update', updatedSession);
    io.to(session.participants[1].toString()).emit('session_update', updatedSession);

  } catch (err) {
    console.error("Error in proceed_to_next_stage:", err);
  }
});
socket.on('send_blind_message', async ({ sessionId, text }) => {
  try {
    const session = await BlindSession.findById(sessionId);
    if (!session || session.status !== 'active') return;

    // ایجاد آبجکت پیام جدید
    const newMessage = {
      sender: socket.userId, // اطمینان حاصل کن که socket.userId ست شده است
      text: text,
      createdAt: new Date()
    };

    // اضافه کردن به دیتابیس
    session.messages.push(newMessage);
    await session.save();

    // مهم: سشن را دوباره با اطلاعات سوالات لود کن تا فرانت‌اِند کرش نکند
    const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');

    // ارسال به هر دو نفر (از طریق آیدی‌های منحصربه‌فردشان)
    io.to(session.participants[0].toString()).emit('session_update', updatedSession);
    io.to(session.participants[1].toString()).emit('session_update', updatedSession);

    console.log(`Message sent in session ${sessionId}`);
  } catch (err) {
    console.error("Error in send_blind_message:", err);
  }
});
socket.on('submit_reveal_decision', async ({ sessionId, decision }) => {
  try {
    const session = await BlindSession.findById(sessionId);
    if (!session) return;

    const isUser1 = session.participants[0].toString() === socket.userId;

    if (isUser1) session.u1RevealDecision = decision;
    else session.u2RevealDecision = decision;

    // اگر هر دو تصمیم گرفتند، وضعیت را به اتمام یافته تغییر بده
    if (session.u1RevealDecision !== 'pending' && session.u2RevealDecision !== 'pending') {
      session.status = 'completed';
    }

    await session.save();

    // اصلاح اصلی اینجاست: نام فیلد questionId است نه question
    const updatedSession = await BlindSession.findById(sessionId)
      .populate('participants', 'name avatar') // برای نمایش عکس و نام در صفحه فینال
      .populate('questions.questionId');       // اصلاح نام فیلد به questionId

    io.to(session.participants[0].toString()).emit('session_update', updatedSession);
    io.to(session.participants[1].toString()).emit('session_update', updatedSession);
    
    console.log(`Reveal decision saved for session: ${sessionId}`);
  } catch (err) {
    console.error("Error in submit_reveal_decision:", err);
  }
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
app.use("/api/reports", reportRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log("DB Error:", err));
