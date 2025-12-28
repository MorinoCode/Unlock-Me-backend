import express from 'express';
import { submitReport } from '../controllers/reportController/reportController.js';
import { optionalProtect } from '../middleware/auth.js';

const router = express.Router();

router.post('/', optionalProtect, submitReport);

export default router;