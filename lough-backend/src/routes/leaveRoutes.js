import express from 'express';
import {
  applyLeave,
  getMyLeaves,
  cancelLeave,
  updateLeave,
  deleteLeave,
  getAllLeaves,
  reviewLeave,
  
} from '../controllers/leaveController.js';
import { verifyToken, verifyAdmin, verifyStaff } from '../middleware/verifyToken.js';

const leaveRouter = express.Router();

// ── Staff ──────────────────────────────────────────────────────────────────
leaveRouter.post('/',            verifyToken, verifyStaff, applyLeave);   // Apply
leaveRouter.get('/my',           verifyToken, verifyStaff, getMyLeaves);  // My leaves
leaveRouter.patch('/:id/cancel', verifyToken, verifyStaff, cancelLeave);  // Cancel pending
leaveRouter.patch('/:id',        verifyToken, verifyStaff, updateLeave);  // ✨ Edit pending
leaveRouter.delete('/:id',       verifyToken, verifyStaff, deleteLeave);  // ✨ Delete (non-pending)

// ── Admin ──────────────────────────────────────────────────────────────────
leaveRouter.get('/',             verifyToken, verifyAdmin, getAllLeaves);  // All leaves
leaveRouter.patch('/:id/review', verifyToken, verifyAdmin, reviewLeave);  // ✨ Review + Toggle



export default leaveRouter;