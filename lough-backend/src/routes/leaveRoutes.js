import express from 'express';
import { applyLeave, getMyLeaves, cancelLeave, getAllLeaves, reviewLeave } from '../controllers/leaveController.js';
import { verifyToken, verifyAdmin, verifyStaff } from '../middleware/verifyToken.js';

const leaveRouter = express.Router();

// Staff
leaveRouter.post('/',              verifyToken, verifyStaff, applyLeave);
leaveRouter.get('/my',             verifyToken, verifyStaff, getMyLeaves);
leaveRouter.patch('/:id/cancel',   verifyToken, verifyStaff, cancelLeave);

// Admin
leaveRouter.get('/',               verifyToken, verifyAdmin, getAllLeaves);
leaveRouter.patch('/:id/review',   verifyToken, verifyAdmin, reviewLeave);

export default leaveRouter;