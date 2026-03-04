// We use the native fetch API available in Node 18+

// ✅ Best Practice: Cloudflare Turnstile Verification Middleware
export const verifyTurnstile = async (req, res, next) => {
  const token = req.body.turnstileToken;

  // 1. Check if token exists in request payload
  if (!token) {
    return res.status(403).json({
      success: false,
      message: "CAPTCHA token is missing. Please complete the security check.",
    });
  }

  // 2. Validate with Cloudflare
  const secretKey = process.env.TURNSTILE_SECRET_KEY || "0x4AAAAAACmGTRMbB-cJNXkWl2xLByqefGI"; // Fallback provided by user
  
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
    });

    const data = await response.json();

    if (!data.success) {
      console.warn("🚫 [Turnstile] Bot blocked:", data["error-codes"]);
      return res.status(403).json({
        success: false,
        message: "Failed security verification. Please try again.",
        errors: data["error-codes"],
      });
    }

    // ✅ Clean up the req.body so the controller doesn't need to see it
    delete req.body.turnstileToken;
    
    // ✅ Token is valid, human is verified!
    next();
  } catch (error) {
    console.error("🔥 [Turnstile] Cloudflare Verification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Service temporarily unavailable due to security check failure.",
    });
  }
};
