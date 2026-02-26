import express from 'express';
import {
  getAuthUrl,
  handleCallback,
  
} from '../controllers/Googlecalendarcontroller.js'
import { verifyToken } from '../middleware/verifyToken.js';

const googleRouter = express.Router();


googleRouter.get('/auth-url',      verifyToken, getAuthUrl);


googleRouter.get('/callback',      handleCallback);

export default googleRouter;