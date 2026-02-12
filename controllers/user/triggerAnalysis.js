import { analysisQueue } from "../../config/queue.js";

// Trigger workers (Analysis + Swipe) for Analysis Page via Queue
export const triggerAnalysisWorkers = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    console.log(`\n========================================`);
    console.log(`[AnalysisPage] 🔧 QUEUEING WORKERS for user: ${userId}`);
    console.log(`========================================`);

    // Add job to BullMQ queue
    await analysisQueue.add("analyze-user", { userId }, {
      removeOnComplete: true, // Auto-remove successful jobs
      removeOnFail: 500 // Keep last 500 failed jobs for debugging
    });

    console.log(`✅ [AnalysisPage] Job added to queue for ${userId}`);
    console.log(`========================================\n`);
    
    // Return immediately to client
    // Client will listen for Socket.IO event 'analysis_complete'
    return res.json({
      ready: false, // Not ready yet
      message: "Analysis started in background...",
      queued: true
    });

  } catch (err) {
    console.error(`\n❌ [AnalysisPage] QUEUE ERROR:`, err);
    console.error(`========================================\n`);
    res.status(500).json({ 
      ready: false,
      message: "Server error. Please try again." 
    });
  }
};
