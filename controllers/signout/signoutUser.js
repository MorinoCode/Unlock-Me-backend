import User from "../../models/User.js";

export const signoutUser = async (req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      domain: isProduction ? ".unlock-me.app" : undefined
    };
    
    // ✅ Security Fix: Clear both tokens
    res.clearCookie("unlock-me-token", cookieOptions);
    res.clearCookie("unlock-me-refresh-token", cookieOptions);
    
    // ✅ Security Fix: Invalidate refresh token in database
    if (req.user?.userId) {
      await User.findByIdAndUpdate(req.user.userId, { 
        $unset: { refreshToken: "" } 
      });
    }

    res.status(200).json({ message: "Signed out successfully" });
  } catch (err) {
    console.error("Signout Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};