import express from "express";
import { loginUser } from "../controllers/login/loginUser.js";
import { signupUser } from "../controllers/signup/signupUser.js";


const router = express.Router();

router.post("/login", loginUser);
router.post("/signup", signupUser);

export default router;
