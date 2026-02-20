import express from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
} from '../controllers/adminController/adminController.js';
import {
  getPendingVerifications,
  approveVerification,
  rejectVerification
} from '../controllers/verificationController/verificationController.js';

const router = express.Router();

// Admin Routes (Currently open, can add protectAdmin middleware later if needed)
router.route('/users')
  .get(getAllUsers);

router.route('/users/:id')
  .get(getUserById)
  .put(updateUser)
  .delete(deleteUser);

// Verification Endpoints
router.get('/verifications/pending', getPendingVerifications);
router.post('/verifications/:userId/approve', approveVerification);
router.post('/verifications/:userId/reject', rejectVerification);

export default router;
