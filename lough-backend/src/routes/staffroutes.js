import express from 'express';
import {
  getAllStaff,
  getStaffById,
  createStaff,
  updateStaff,
  toggleStaffActive,
  resendInvite,
  deleteStaff,
} from '../controllers/Staffcontroller.js';
import { verifyToken, verifyAdmin } from '../middleware/verifyToken.js';

const staffRouter = express.Router();

staffRouter.get('/',                     verifyToken, verifyAdmin, getAllStaff);
staffRouter.get('/:id',                  verifyToken, verifyAdmin, getStaffById);
staffRouter.post('/',                    verifyToken, verifyAdmin, createStaff);
staffRouter.put('/:id',                  verifyToken, verifyAdmin, updateStaff);
staffRouter.patch('/:id/toggle-active',  verifyToken, verifyAdmin, toggleStaffActive);
staffRouter.patch('/:id/resend-invite',  verifyToken, verifyAdmin, resendInvite);
staffRouter.delete('/:id',               verifyToken, verifyAdmin, deleteStaff);

export default staffRouter;