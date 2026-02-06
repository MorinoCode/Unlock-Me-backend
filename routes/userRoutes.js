// userRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { getUserDetails, getUserLocation } from "../controllers/explore/explore.js";
import { handleDislike, handleLike } from "../controllers/userActions/userActions.js";
import { 
  deleteAccount,
  forgotPassword,
  getUserById, 
  getUserInformation, 
  updateCategoryAnswers, 
  updateGallery, 
  updatePassword, 
  updateProfileInfo,
  getMatchesDashboard
} from "../controllers/userController/userController.js";
import { authLimiter } from "../middleware/authLimiter.js";
import { signinUser } from "../controllers/signin/signinUser.js";
import { signupUser } from "../controllers/signup/signupUser.js";
import { signoutUser } from "../controllers/signout/signoutUser.js";
import { refreshToken } from "../controllers/auth/refreshToken.js";
// ✅ Security Fix: Import validation middleware
import { validateSignup, validateSignin, validateUpdateProfile, validateUpdatePassword } from "../middleware/validation.js";

const router = express.Router();

router.post("/signin", authLimiter, validateSignin, signinUser);
router.post("/signup", authLimiter, validateSignup, signupUser);
router.post("/signout", authLimiter, signoutUser);
router.post("/refresh-token", refreshToken); // ✅ Security Fix: Token refresh endpoint
router.post("/forgot-password", authLimiter, forgotPassword);

router.get("/location", protect, getUserLocation);
router.get("/getUserInformation", protect, getUserInformation);
router.get("/details/:userId", protect, getUserDetails); 


router.get("/user/:userId", protect, getUserById); 

router.post("/like", protect, handleLike);
router.post("/dislike", protect, handleDislike);
router.get("/matches", protect, getMatchesDashboard);

router.put("/profile/info", protect, validateUpdateProfile, updateProfileInfo);
router.put("/profile/password", protect, validateUpdatePassword, updatePassword);
router.put("/profile/gallery", protect, updateGallery);
router.put("/profile/categories", protect, updateCategoryAnswers);
router.delete("/profile/delete-account", protect, deleteAccount); 
router.get("/matches/matches-dashbord", protect, getMatchesDashboard); 


export default router;