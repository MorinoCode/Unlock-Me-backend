import express from "express";
import { signinUser } from "../controllers/signin/signinUser.js";
import { signupUser } from "../controllers/signup/signupUser.js";
import { authLimiter } from "../middleware/authLimiter.js";
import { getUserById } from "../controllers/userController/userController.js"


const router = express.Router();

router.post("/signin",authLimiter, signinUser);
router.post("/signup",authLimiter, signupUser);
router.get("/user/:userId", getUserById);
export default router;
