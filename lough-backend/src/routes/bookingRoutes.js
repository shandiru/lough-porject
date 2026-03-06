import express from 'express';
import {
  getAvailableSlots,
  createBooking,
  getAllBookings,
  getMyBookings,
} from '../controllers/bookingController.js';
import { verifyToken, verifyAdmin } from '../middleware/verifyToken.js';

const bookingRouter = express.Router();

// Public: available slots (customer must be logged in to book but can see slots)
bookingRouter.get('/available-slots', verifyToken, getAvailableSlots);

// Customer: create booking (logged in)
bookingRouter.post('/', verifyToken, createBooking);

// Customer: my bookings
bookingRouter.get('/my', verifyToken, getMyBookings);

// Admin: all bookings + create on behalf
bookingRouter.get('/', verifyToken, verifyAdmin, getAllBookings);
bookingRouter.post('/admin', verifyToken, verifyAdmin, createBooking);

export default bookingRouter;
