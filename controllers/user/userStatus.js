import redisClient from "../../config/redis.js";

// Check if user is ready (Analysis + Swipe workers completed)
export const checkUserReady = async (req, res) => {
  try {
    const userId = req.user.userId;
    const isReady = await redisClient.get(`user:ready:${userId}`);
    
    res.json({ 
      isReady: !!isReady,
      userId 
    });
  } catch (err) {
    console.error("Check User Ready Error:", err);
    res.status(500).json({ 
      message: "Failed to check ready status.",
      isReady: false 
    });
  }
};
