// userRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { getUserDetails, getUserLocation } from "../controllers/explore/explore.js";
import { getMatchesDashboard, handleDislike, handleLike } from "../controllers/userActions/userActions.js";
import { 
  getUserById, 
  getUserInformation, 
  updateCategoryAnswers, 
  updateGallery, 
  updatePassword, 
  updateProfileInfo 
} from "../controllers/userController/userController.js";
import { authLimiter } from "../middleware/authLimiter.js";
import { signinUser } from "../controllers/signin/signinUser.js";
import { signupUser } from "../controllers/signup/signupUser.js";
import { signoutUser } from "../controllers/signout/signoutUser.js";

const router = express.Router();

router.post("/signin",authLimiter, signinUser);
router.post("/signup",authLimiter, signupUser);
router.post("/signout",authLimiter, signoutUser);

router.get("/location", protect, getUserLocation);
router.get("/getUserInformation", protect, getUserInformation);
router.get("/details/:userId", protect, getUserDetails); 


router.get("/user/:userId", protect, getUserById); 

router.post("/like", protect, handleLike);
router.post("/dislike", protect, handleDislike);
router.get("/matches", protect, getMatchesDashboard);

router.put("/profile/info", protect, updateProfileInfo);
router.put("/profile/password", protect, updatePassword);
router.put("/profile/gallery", protect, updateGallery);
router.put("/profile/categories", protect, updateCategoryAnswers);

export default router;