import express from 'express';
import {
  getAuthUrl,
  handleCallback,
  disconnectCalendar
  
} from '../controllers/Googlecalendarcontroller.js'
import { verifyToken ,verifyStaff} from '../middleware/verifyToken.js';

const googleRouter = express.Router();


googleRouter.get('/auth-url', verifyToken,verifyStaff, getAuthUrl);
googleRouter.get('/callback',      handleCallback);
googleRouter.delete('/disconnect', verifyToken, verifyStaff, disconnectCalendar);
export default googleRouter;