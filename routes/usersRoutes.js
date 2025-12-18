import express from "express";
import { signinUser } from "../controllers/signin/signinUser.js";
import { signupUser } from "../controllers/signup/signupUser.js";
import { authLimiter } from "../middleware/authLimiter.js";


const router = express.Router();

router.post("/signin",authLimiter, signinUser);
router.post("/signup",authLimiter, signupUser);

export default router;
