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
import blindDateRoutes from "./routes/blindDateRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
// import { addToQueue } from "./utils/blindDateService.js"; // ❌ Removed
import BlindSession from "./models/BlindSession.js";
import BlindQuestion from "./models/BlindQuestion.js";
import "./workers/matchWorker.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Map to store active user IDs and their corresponding socket IDs for notifications
const userSocketMap = new Map(); 

// ✅ New Queue for Blind Date
let blindQueue = []; 

// Exporting this to be used in controllers to find online users
export const getReceiverSocketId = (receiverId) => {
  return userSocketMap.get(receiverId);
};

const corsOptions = {
  origin: function (origin, callback) {
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
      console.log("Blocked by CORS:", origin);
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

app.set("io", io);

// ✅ DEBUG MATCHING LOGIC
const findMatch = (user1) => {
  console.log(`\n🔍 --- START MATCHING FOR: ${user1.userId} ---`);
  console.log(`   User1 Details: Gender=${user1.criteria.gender}, LookingFor=${user1.criteria.lookingFor}, Country=${user1.criteria.location?.country}`);

  return blindQueue.find((user2) => {
    console.log(`   👀 Comparing with User inside Queue: ${user2.userId}`);
    
    // 1. Self Match Check
    if (user1.userId === user2.userId) {
        console.log("      ❌ Skipped: Same User ID");
        return false;
    }

    // 2. Country Check
    const c1 = user1.criteria.location?.country || "Unknown";
    const c2 = user2.criteria.location?.country || "Unknown";
    
    const countryMatch = c1.trim().toLowerCase() === c2.trim().toLowerCase();
    
    if (!countryMatch) {
        console.log(`      ❌ Country Mismatch: '${c1}' vs '${c2}'`);
        return false;
    }

    // 3. Gender Check
    const u1Gender = user1.criteria.gender?.toLowerCase() || 'unknown';
    const u1Looking = user1.criteria.lookingFor?.toLowerCase() || 'all';
    
    const u2Gender = user2.criteria.gender?.toLowerCase() || 'unknown';
    const u2Looking = user2.criteria.lookingFor?.toLowerCase() || 'all';

    console.log(`      ⚖️ Logic Check:`);
    console.log(`         User1 (${u1Gender}) looking for (${u1Looking}) -> Wants User2 (${u2Gender})?`);
    console.log(`         User2 (${u2Gender}) looking for (${u2Looking}) -> Wants User1 (${u1Gender})?`);

    // شرط ۱: جنسیت کاربر ۲ باید با خواسته کاربر ۱ بخواند
    const match1 = u1Looking === 'all' || u1Looking === u2Gender;
    
    // شرط ۲: جنسیت کاربر ۱ باید با خواسته کاربر ۲ بخواند
    const match2 = u2Looking === 'all' || u2Looking === u1Gender;

    if (!match1) console.log(`      ❌ User1 REJECTED User2 (Gender mismatch)`);
    if (!match2) console.log(`      ❌ User2 REJECTED User1 (Gender mismatch)`);

    if (match1 && match2) {
        console.log("      ✅✅ MATCH FOUND!");
        return true;
    } 
    return false;
  });
};

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  
  if (userId && userId !== "undefined") {
    socket.userId = userId; 
    socket.join(userId); 
    userSocketMap.set(userId, socket.id); 
    console.log(`User ${userId} connected and joined room.`);
  }

  // --- BLIND DATE MATCHING LOGIC ---
  socket.on("join_blind_queue", async (data) => {
    const currentUserId = socket.userId || data.userId;
    if (!currentUserId) {
        console.error("No User ID found for blind queue");
        return;
    }

    const currentUser = {
      socketId: socket.id,
      userId: currentUserId,
      criteria: data.criteria || {}
    };

    console.log(`User ${currentUserId} joining queue...`);

    // Try to find a match in the queue
    const match = findMatch(currentUser);

    if (match) {
      console.log(`Match Found! ${currentUser.userId} + ${match.userId}`);
      
      // Remove matched user from queue
      blindQueue = blindQueue.filter(u => u.userId !== match.userId);

      // Create Session
      try {
        const questionsStage1 = await BlindQuestion.aggregate([
          { $match: { stage: 1 } },
          { $sample: { size: 5 } },
        ]);

        const formattedQuestions = questionsStage1.map(q => ({
          questionId: q._id,
          u1Answer: null,
          u2Answer: null
        }));

        const newSession = new BlindSession({
          participants: [currentUser.userId, match.userId],
          status: 'instructions', 
          currentStage: 1,
          questions: formattedQuestions,
          startTime: new Date(),
        });

        await newSession.save();

        const populatedSession = await BlindSession.findById(newSession._id)
            .populate('questions.questionId');

        // Notify both users
        io.to(currentUser.userId).emit("match_found", populatedSession);
        io.to(match.userId).emit("match_found", populatedSession);

      } catch (err) {
        console.error("Error creating blind session:", err);
      }

    } else {
      // No match found -> Add to queue
      // Prevent duplicates
      const exists = blindQueue.find(u => u.userId === currentUserId);
      if (!exists) {
          blindQueue.push(currentUser);
          console.log("User added to queue. Waiting...");
      } else {
          console.log("User already in queue.");
      }
    }
  });

  // --- Handle Disconnect from Queue ---
  socket.on("leave_blind_queue", () => {
      blindQueue = blindQueue.filter(u => u.socketId !== socket.id);
  });

  socket.on('confirm_instructions', async ({ sessionId }) => {
    try {
      const session = await BlindSession.findById(sessionId);
      if (!session) return;

      const isUser1 = session.participants[0].toString() === socket.userId;
      
      if (isUser1) session.stageProgress.u1InstructionRead = true;
      else session.stageProgress.u2InstructionRead = true;

      if (session.stageProgress.u1InstructionRead && session.stageProgress.u2InstructionRead) {
        session.status = 'active'; 
        session.currentStage = 1;
      }

      await session.save();
      
      const updatedSession = await BlindSession.findById(sessionId).populate('questions.questionId');
      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
      
    } catch (err) { console.error(err); }
  });

  socket.on("join_room", (id) => {
    if (!socket.userId) {
      socket.userId = id;
      socket.join(id);
      userSocketMap.set(id, socket.id);
    }
  });

  socket.on("typing", ({ receiverId, senderId }) => {
    io.to(receiverId).emit("display_typing", { senderId });
  });

  socket.on("stop_typing", ({ receiverId }) => {
    io.to(receiverId).emit("hide_typing");
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
        const maxIndex = session.questions.length - 1;

        if (session.currentQuestionIndex < maxIndex) {
            session.currentQuestionIndex += 1;
        } else {
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

      if (session.stageProgress.u1ReadyNext && session.stageProgress.u2ReadyNext) {
        session.currentStage += 1;
        session.status = 'active';
        session.currentQuestionIndex += 1;
        
        session.stageProgress.u1ReadyNext = false;
        session.stageProgress.u2ReadyNext = false;

        if (session.currentStage === 2) {
           const nextQuestions = await BlindQuestion.aggregate([
              { $match: { stage: 2 } }, 
              { $sample: { size: 5 } }
           ]);
           
           const newQs = nextQuestions.map(q => ({
              questionId: q._id,
              u1Answer: null,
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

      if (session.participants[0].toString() === socket.userId) {
         session.u1RevealDecision = decision;
      } else {
         session.u2RevealDecision = decision;
      }

      if (session.u1RevealDecision !== 'pending' && session.u2RevealDecision !== 'pending') {
        if (session.u1RevealDecision === 'yes' && session.u2RevealDecision === 'yes') {
            session.status = 'completed'; 
        } else {
            session.status = 'cancelled';
        }
      }

      await session.save();
      
      const updatedSession = await BlindSession.findById(sessionId)
        .populate('participants', 'name avatar')
        .populate('questions.questionId');

      io.to(session.participants[0].toString()).emit('session_update', updatedSession);
      io.to(session.participants[1].toString()).emit('session_update', updatedSession);
      
    } catch (err) { console.error(err); }
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      // ✅ Cleanup from Blind Queue
      blindQueue = blindQueue.filter(u => u.socketId !== socket.id);
      
      userSocketMap.delete(socket.userId);
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
app.use('/api/blind-date', blindDateRoutes);
app.get("/ping", (req, res) => {
  res.status(200).send("pong 🏓");
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log("DB Error:", err));