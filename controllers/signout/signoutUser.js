export const signoutUser = async (req, res) => {
  try {
    res.clearCookie("unlock-me-token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/", 
    });

    res.status(200).json({ message: "Signed out successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error during signout", error: err.message });
  }
};