import express from 'express';
import {
  getAvailableSlots,
  createBooking,
  getAllBookings,
  getMyBookings,
  getStaffBookings,
  requestCancellation,
  reviewCancellation,
  updateBookingStatus,
  adminCancelBooking,
  getCalendarBookings,
  submitConsultationForm,
} from '../controllers/bookingController.js';
import { verifyToken, verifyAdmin, verifyStaff } from '../middleware/verifyToken.js';

const bookingRouter = express.Router();

// Available slots (public with token)
bookingRouter.get('/available-slots', verifyToken, getAvailableSlots);

// Calendar view (admin)
bookingRouter.get('/calendar',             verifyToken, verifyAdmin,  getCalendarBookings);

// Customer
bookingRouter.get('/my',                   verifyToken,               getMyBookings);
bookingRouter.post('/:id/cancel-request',  verifyToken,               requestCancellation);

// ✅ FIX: Staff — own bookings (User._id → Staff._id → Bookings)
bookingRouter.get('/staff/my',             verifyToken, verifyStaff,  getStaffBookings);

// Admin
bookingRouter.get('/',                     verifyToken, verifyAdmin,  getAllBookings);
bookingRouter.post('/admin',               verifyToken, verifyAdmin,  createBooking);
bookingRouter.post('/:id/cancel-review',   verifyToken, verifyAdmin,  reviewCancellation);
bookingRouter.post('/:id/admin-cancel',    verifyToken, verifyAdmin,  adminCancelBooking);
bookingRouter.patch('/:id/status',         verifyToken, verifyAdmin,  updateBookingStatus);

// Customer — submit consultation form after payment
bookingRouter.post('/:id/consultation-form', verifyToken, submitConsultationForm);

export default bookingRouter;