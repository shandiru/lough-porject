import express from 'express';
const leaverouter = express.Router();
import { 
  requestLeave, approveLeave, rejectLeave, cancelLeave, getMyLeaves, getAllLeaves 
} from '../controllers/leaveController.js'
import { verifyToken, verifyAdmin ,verifyStaff } from '../middleware/verifyToken.js';


leaverouter.get('/my-leaves', verifyToken,verifyStaff, getMyLeaves);
leaverouter.post('/request',  verifyToken,verifyStaff, requestLeave);
leaverouter.delete('/cancel/:id',verifyToken,verifyStaff, cancelLeave);


leaverouter.get('/admin/all', verifyToken,verifyAdmin, getAllLeaves);
leaverouter.put('/admin/approve/:id',  verifyToken,verifyAdmin,  approveLeave);
leaverouter.put('/admin/reject/:id',  verifyToken,verifyAdmin,  rejectLeave);

export default leaverouter;