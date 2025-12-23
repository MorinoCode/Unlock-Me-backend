import express from "express";
import { protect } from "../middleware/auth.js";
import { getExploreMatches, getUserDetails, getUserLocation } from "../controllers/explore/explore.js";
import { getMatchesDashboard, handleDislike, handleLike } from "../controllers/userActions/userActions.js";
import { 
  getUserById, 
  updateCategoryAnswers, 
  updateGallery, 
  updatePassword, 
  updateProfileInfo 
} from "../controllers/userController/userController.js";

const router = express.Router();

router.get("/location", protect, getUserLocation);
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