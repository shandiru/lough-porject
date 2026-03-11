import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import {
  createCheckoutSession,
  getSessionBooking,
} from '../controllers/paymentController.js';

const paymentRouter = express.Router();

// Customer creates a Stripe checkout session (slot lock + redirect URL)
paymentRouter.post('/create-checkout', verifyToken, createCheckoutSession);

// ⚠️  /webhook is intentionally NOT here.
//    It is mounted directly in app.js with express.raw() BEFORE express.json()
//    so Stripe's signature verification gets the raw Buffer it needs.

// Frontend polls this after Stripe redirect — no auth required (fresh page load after redirect)
paymentRouter.get('/session/:sessionId', getSessionBooking);

export default paymentRouter;
