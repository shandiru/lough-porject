import Booking from '../models/bookingModel.js';
import Staff from '../models/staff.js';
import Service from '../models/service.js';
import Leave from '../models/leave.js';
import User from '../models/user.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert "HH:MM" to minutes since midnight */
const toMins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Convert minutes since midnight to "HH:MM" */
const fromMins = (m) => {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
};

const BUFFER = 15; // minutes buffer between bookings

/**
 * Check whether a proposed slot [startMins, endMins] is free for a staff member
 * on a given date, considering:
 *  - staff working hours & breaks
 *  - existing bookings (+ 15-min buffer)
 *  - approved leaves
 */
const isSlotAvailable = async (staffId, date, startMins, endMins) => {
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayName = dayNames[new Date(date).getDay()];

  const staff = await Staff.findById(staffId);
  if (!staff) return false;

  // 1. Leave check
  if (staff.isOnLeave) return false;

  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  const hasLeave = await Leave.findOne({
    staffId,
    status: 'approved',
    startDate: { $lte: new Date(date) },
    endDate:   { $gte: new Date(date) },
  });
  if (hasLeave) return false;

  // 2. Working hours check
  const daySchedule = staff.workingHours?.[dayName];
  if (!daySchedule || !daySchedule.isWorking) return false;

  const workStart = toMins(daySchedule.start || '09:00');
  const workEnd   = toMins(daySchedule.end   || '17:00');

  if (startMins < workStart || endMins > workEnd) return false;

  // 3. Break check
  const breaks = daySchedule.breaks || [];
  for (const brk of breaks) {
    const bStart = toMins(brk.start);
    const bEnd   = toMins(brk.end);
    if (startMins < bEnd && endMins > bStart) return false;
  }

  // 4. Existing booking check (with buffer)
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const existingBookings = await Booking.find({
    staffMember: staffId,
    bookingDate: { $gte: dayStart, $lte: dayEnd },
    status:      { $nin: ['cancelled'] },
  });

  for (const bk of existingBookings) {
    const bStart = toMins(bk.bookingTime);
    const bEnd   = bStart + bk.duration;
    // Apply buffer on both sides
    if (startMins < bEnd + BUFFER && endMins > bStart - BUFFER) return false;
  }

  return true;
};

// ─── GET /api/bookings/available-slots ──────────────────────────────────────
/**
 * Query params: serviceId, date, customerGender
 * Returns list of { staff: {...}, availableSlots: ['09:00', '09:45', ...] }
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const { serviceId, date, customerGender } = req.query;

    if (!serviceId || !date) {
      return res.status(400).json({ message: 'serviceId and date are required' });
    }

    const service = await Service.findById(serviceId);
    if (!service || !service.isActive) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Gender eligibility check
    const sGender = service.genderRestriction;
    if (sGender !== 'all') {
      const allowed = sGender === 'male-only' ? 'male' : 'female';
      if (customerGender && customerGender !== allowed) {
        return res.status(200).json([]);
      }
    }

    const duration = service.duration;

    // Find staff who have this service as a skill
    const allStaff = await Staff.find({ skills: serviceId })
      .populate('userId', 'firstName lastName profileImage gender isActive');

    // Filter active staff
    const activeStaff = allStaff.filter(s => s.userId?.isActive);

    const result = [];

    for (const staff of activeStaff) {
      // Staff gender restriction:
      // male-only staff → only male customers
      // female-only staff → only female customers
      // 'all' → any customer
      const staffGR = staff.genderRestriction;
      if (staffGR === 'male-only' && customerGender !== 'male') continue;
      if (staffGR === 'female-only' && customerGender !== 'female') continue;

      // Build time slots for the day
      const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      const dayName = dayNames[new Date(date).getDay()];
      const daySchedule = staff.workingHours?.[dayName];

      if (!daySchedule || !daySchedule.isWorking) continue;

      // Check leave
      if (staff.isOnLeave) continue;
      const hasLeave = await Leave.findOne({
        staffId: staff._id,
        status: 'approved',
        startDate: { $lte: new Date(date) },
        endDate:   { $gte: new Date(date) },
      });
      if (hasLeave) continue;

      const workStart = toMins(daySchedule.start || '09:00');
      const workEnd   = toMins(daySchedule.end   || '17:00');

      const availableSlots = [];

      // Step through every 15-min increment
      for (let t = workStart; t + duration <= workEnd; t += 15) {
        const slotEnd = t + duration;
        const ok = await isSlotAvailable(staff._id, date, t, slotEnd);
        if (ok) {
          availableSlots.push(fromMins(t));
        }
      }

      if (availableSlots.length > 0) {
        result.push({
          staff: {
            _id:          staff._id,
            name:         `${staff.userId.firstName} ${staff.userId.lastName}`,
            profileImage: staff.userId.profileImage || null,
            gender:       staff.userId.gender,
          },
          availableSlots,
        });
      }
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/bookings ──────────────────────────────────────────────────────
export const createBooking = async (req, res) => {
  try {
    const {
      // Customer info
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerGender,
      customerNotes,
      // Booking
      serviceId,
      staffId,
      bookingDate,
      bookingTime,
      // Source
      bookingSource = 'website',
      // Admin only
      internalNotes,
    } = req.body;

    // Fetch service
    const service = await Service.findById(serviceId);
    if (!service || !service.isActive) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const duration = service.duration;
    const startMins = toMins(bookingTime);
    const endMins   = startMins + duration;

    // Check slot availability
    const available = await isSlotAvailable(staffId, bookingDate, startMins, endMins);
    if (!available) {
      return res.status(409).json({ message: 'This time slot is no longer available. Please choose another.' });
    }

    // Calculate amounts
    const totalAmount   = service.price * 100; // pence
    const depositAmount = Math.round(totalAmount * service.depositPercentage);

    // Generate booking number
    const bookingNumber = `BK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const booking = new Booking({
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerGender,
      customerNotes,
      service:     serviceId,
      staffMember: staffId,
      bookingDate:  new Date(bookingDate),
      bookingTime,
      duration,
      status:           'pending',
      totalAmount,
      depositAmount,
      paidAmount:       0,
      balanceRemaining: totalAmount,
      paymentType:      'deposit',
      paymentStatus:    'pending',
      consentFormCompleted: false,
      bookingSource,
      internalNotes,
      createdBy: req.user?.id || null,
    });

    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate('service', 'name price duration')
      .populate({
        path: 'staffMember',
        populate: { path: 'userId', select: 'firstName lastName profileImage' },
      });

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/bookings (admin) ───────────────────────────────────────────────
export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('service', 'name price duration')
      .populate({
        path: 'staffMember',
        populate: { path: 'userId', select: 'firstName lastName profileImage' },
      })
      .sort({ createdAt: -1 });

    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/bookings/my (customer) ────────────────────────────────────────
export const getMyBookings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const bookings = await Booking.find({ customerEmail: user.email })
      .populate('service', 'name price duration')
      .populate({
        path: 'staffMember',
        populate: { path: 'userId', select: 'firstName lastName profileImage' },
      })
      .sort({ bookingDate: -1 });

    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};