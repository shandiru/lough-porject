import express from 'express';
import {
  getAllStaff,
  createStaff,
  updateStaff,
  toggleStaffActive,
  resendInvite,
  deleteStaff,
  getGoogleCalenderStatus
} from '../controllers/Staffcontroller.js';
import { verifyToken, verifyAdmin ,verifyStaff } from '../middleware/verifyToken.js';

const staffRouter = express.Router();
staffRouter.get('/getGoogleCalenderStatus', verifyToken, verifyStaff,getGoogleCalenderStatus);
staffRouter.get('/',                     verifyToken, verifyAdmin, getAllStaff);
staffRouter.post('/',                    verifyToken, verifyAdmin, createStaff);
staffRouter.put('/:id',                  verifyToken, verifyAdmin, updateStaff);
staffRouter.patch('/:id/toggle-active',  verifyToken, verifyAdmin, toggleStaffActive);
staffRouter.patch('/:id/resend-invite',  verifyToken, verifyAdmin, resendInvite);
staffRouter.delete('/:id',               verifyToken, verifyAdmin, deleteStaff);

export default staffRouter;