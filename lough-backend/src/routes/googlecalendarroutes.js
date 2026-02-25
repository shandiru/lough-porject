import express from 'express';
import {
  getAuthUrl,
  handleCallback,
  disconnectCalendar,
} from '../controllers/Googlecalendarcontroller.js'
import { verifyToken } from '../middleware/verifyToken.js';

const googleRouter = express.Router();


googleRouter.get('/auth-url',      verifyToken, getAuthUrl);


googleRouter.get('/callback',      handleCallback);


googleRouter.delete('/disconnect', verifyToken, disconnectCalendar);

export default googleRouter;