import express from 'express';
import {
  getAvailableSlots,
  createBooking,
  getAllBookings,
  getMyBookings,
  requestCancellation,
  reviewCancellation,
  updateBookingStatus,
} from '../controllers/bookingController.js';
import { verifyToken, verifyAdmin } from '../middleware/verifyToken.js';

const bookingRouter = express.Router();

// Available slots
bookingRouter.get('/available-slots', verifyToken, getAvailableSlots);

// Customer
bookingRouter.get('/my',                   verifyToken,              getMyBookings);
bookingRouter.post('/:id/cancel-request',  verifyToken,              requestCancellation);

// Admin
bookingRouter.get('/',                     verifyToken, verifyAdmin,  getAllBookings);
bookingRouter.post('/admin',               verifyToken, verifyAdmin,  createBooking);
bookingRouter.post('/:id/cancel-review',   verifyToken, verifyAdmin,  reviewCancellation);
bookingRouter.patch('/:id/status',         verifyToken, verifyAdmin,  updateBookingStatus);

export default bookingRouter;
