import Booking       from '../models/bookingModel.js';
import Staff         from '../models/staff.js';
import Service       from '../models/service.js';
import Leave         from '../models/leave.js';
import User          from '../models/user.js';
import Googlebooking from '../models/googlebooking.js';
import { google }    from 'googleapis';
import config        from '../config/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "HH:MM" → minutes since midnight */
const toMins = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** minutes since midnight → "HH:MM" */
const fromMins = (m) => {
  const h  = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
};

const BUFFER = 15; // minutes gap required between bookings

// ─── Google Calendar event creator ───────────────────────────────────────────
const addToGoogleCalendar = async (staff, booking, service) => {
  try {
    // Only proceed if staff has Google Calendar connected
    if (
      !staff.googleCalendarToken?.access_token ||
      !staff.googleCalendarToken?.refresh_token ||
      staff.googleCalendarSyncStatus?.status !== 'connected'
    ) return null;

    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri,
    );
    oauth2Client.setCredentials({
      access_token:  staff.googleCalendarToken.access_token,
      refresh_token: staff.googleCalendarToken.refresh_token,
      expiry_date:   staff.googleCalendarToken.expiry_date,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Build ISO datetime strings for the booking
    const dateStr   = new Date(booking.bookingDate).toISOString().split('T')[0]; // "YYYY-MM-DD"
    const startStr  = `${dateStr}T${booking.bookingTime}:00`;
    const endMins   = toMins(booking.bookingTime) + service.duration;
    const endStr    = `${dateStr}T${fromMins(endMins)}:00`;

    const event = await calendar.events.insert({
      calendarId: staff.googleCalendarId || 'primary',
      requestBody: {
        summary:     `${service.name} — ${booking.customerName}`,
        description: [
          `Booking #${booking.bookingNumber}`,
          `Customer: ${booking.customerName}`,
          `Phone: ${booking.customerPhone}`,
          `Email: ${booking.customerEmail}`,
          booking.customerNotes ? `Notes: ${booking.customerNotes}` : '',
        ].filter(Boolean).join('\n'),
        start: { dateTime: startStr, timeZone: 'Europe/London' },
        end:   { dateTime: endStr,   timeZone: 'Europe/London' },
        colorId: '2', // sage green
      },
    });

    return event.data.id || null;
  } catch (err) {
    console.error('[Google Cal] Failed to create event:', err.message);
    return null; // Non-fatal — booking still succeeds
  }
};

// ─── isSlotAvailable ──────────────────────────────────────────────────────────
/**
 * Returns true if [startMins, endMins] is a valid free slot for the staff on
 * the given date.
 *
 * Checks (in order):
 *   1. Staff.isOnLeave quick flag
 *   2. Leave model — approved full-day AND hourly windows
 *   3. Working hours for that day
 *   4. Break windows
 *   5. Existing Booking model entries + 15-min buffer
 *   6. Googlebooking model (synced Google Calendar events) + 15-min buffer
 */
const isSlotAvailable = async (staffId, date, startMins, endMins) => {
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayName  = dayNames[new Date(date).getDay()];

  const staff = await Staff.findById(staffId);
  if (!staff) return false;

  // 1. Fast-path: isOnLeave flag (full-day only)
  if (staff.isOnLeave) return false;

  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

  // 2. Leave model — covers both full-day and hourly
  const approvedLeaves = await Leave.find({
    staffId,
    status:    'approved',
    startDate: { $lte: dayEnd },
    endDate:   { $gte: dayStart },
  });

  for (const lv of approvedLeaves) {
    if (!lv.isHourly) {
      // Full-day leave → slot is blocked entirely
      return false;
    }
    // Hourly leave → check time overlap
    const lStart = toMins(lv.startTime);
    const lEnd   = toMins(lv.endTime);
    if (startMins < lEnd && endMins > lStart) return false;
  }

  // 3. Working hours
  const daySchedule = staff.workingHours?.[dayName];
  if (!daySchedule || !daySchedule.isWorking) return false;

  const workStart = toMins(daySchedule.start || '09:00');
  const workEnd   = toMins(daySchedule.end   || '17:00');
  if (startMins < workStart || endMins > workEnd) return false;

  // 4. Break windows
  for (const brk of (daySchedule.breaks || [])) {
    const bStart = toMins(brk.start);
    const bEnd   = toMins(brk.end);
    if (startMins < bEnd && endMins > bStart) return false;
  }

  // 5. Existing Booking model entries + 15-min buffer
  const existingBookings = await Booking.find({
    staffMember: staffId,
    bookingDate: { $gte: dayStart, $lte: dayEnd },
    status:      { $nin: ['cancelled'] },
  });

  for (const bk of existingBookings) {
    const bStart = toMins(bk.bookingTime);
    const bEnd   = bStart + bk.duration;
    // 15-min buffer on both sides
    if (startMins < bEnd + BUFFER && endMins > bStart - BUFFER) return false;
  }

  // 6. Google Calendar (Googlebooking) entries + 15-min buffer
  const googleBookings = await Googlebooking.find({
    staffId,
    date: { $gte: dayStart, $lte: dayEnd },
  });

  for (const gb of googleBookings) {
    const gbStart = toMins(gb.startTime);
    const gbEnd   = toMins(gb.endTime);
    if (startMins < gbEnd + BUFFER && endMins > gbStart - BUFFER) return false;
  }

  return true;
};

// ─── GET /api/bookings/available-slots ───────────────────────────────────────
/**
 * Query params:
 *   serviceId             — required
 *   date                  — required  (YYYY-MM-DD)
 *   customerGender        — optional  customer's own gender
 *   staffGenderPreference — optional  'male' | 'female' | 'any'
 *
 * Filter pipeline per staff member:
 *   A. Must have service as a skill
 *   B. userId.isActive must be true
 *   C. Service genderRestriction must allow customerGender
 *   D. Staff genderRestriction must allow customerGender
 *   E. Staff userId.gender must match staffGenderPreference (if set)
 *   F. Staff.isOnLeave must be false
 *   G. No approved full-day Leave covering this date
 *   H. Must be a working day
 *   I. Per-slot: isSlotAvailable (working hours + breaks + Booking+buffer + Googlebooking+buffer + hourly leaves)
 *
 * Returns: [{ staff: { _id, name, gender, profileImage }, availableSlots: ['09:00', ...] }]
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const { serviceId, date, customerGender, staffGenderPreference } = req.query;

    if (!serviceId || !date) {
      return res.status(400).json({ message: 'serviceId and date are required' });
    }

    // Load service
    const service = await Service.findById(serviceId);
    if (!service || !service.isActive) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // C. Service-level gender restriction
    if (service.genderRestriction !== 'all') {
      const allowed = service.genderRestriction === 'male-only' ? 'male' : 'female';
      if (customerGender && customerGender !== allowed) {
        return res.status(200).json([]); // service not available for this customer gender
      }
    }

    const duration = service.duration;
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName  = dayNames[new Date(date).getDay()];

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    // A. Find all staff who have this service as a skill
    const allStaff = await Staff.find({ skills: serviceId })
      .populate('userId', 'firstName lastName profileImage gender isActive');

    const result = [];

    for (const staff of allStaff) {
      const u = staff.userId;

      // B. Active user
      if (!u?.isActive) continue;

      // D. Staff genderRestriction vs customerGender
      if (staff.genderRestriction === 'male-only'   && customerGender !== 'male')   continue;
      if (staff.genderRestriction === 'female-only' && customerGender !== 'female') continue;

      // E. Customer's preferred staff gender (e.g. "I want female staff only")
      if (staffGenderPreference && staffGenderPreference !== 'any') {
        if (u.gender !== staffGenderPreference) continue;
      }

      // F. isOnLeave quick flag
      if (staff.isOnLeave) continue;

      // G. Full-day approved leave check
      const fullDayLeave = await Leave.findOne({
        staffId:   staff._id,
        status:    'approved',
        isHourly:  { $ne: true },
        startDate: { $lte: dayEnd },
        endDate:   { $gte: dayStart },
      });
      if (fullDayLeave) continue;

      // H. Working hours for this day
      const daySchedule = staff.workingHours?.[dayName];
      if (!daySchedule || !daySchedule.isWorking) continue;

      const workStart = toMins(daySchedule.start || '09:00');
      const workEnd   = toMins(daySchedule.end   || '17:00');

      // I. Generate and test each 15-min slot
      const availableSlots = [];
      for (let t = workStart; t + duration <= workEnd; t += 15) {
        const ok = await isSlotAvailable(staff._id, date, t, t + duration);
        if (ok) availableSlots.push(fromMins(t));
      }

      if (availableSlots.length > 0) {
        result.push({
          staff: {
            _id:          staff._id,
            name:         `${u.firstName} ${u.lastName}`,
            gender:       u.gender,
            profileImage: u.profileImage || null,
          },
          availableSlots,
        });
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('[getAvailableSlots]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/bookings ───────────────────────────────────────────────────────
export const createBooking = async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerGender,
      customerNotes,
      serviceId,
      staffId,
      bookingDate,
      bookingTime,
      bookingSource = 'website',
      internalNotes,
    } = req.body;

    // Validate service
    const service = await Service.findById(serviceId);
    if (!service || !service.isActive) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const duration  = service.duration;
    const startMins = toMins(bookingTime);
    const endMins   = startMins + duration;

    // Race-condition guard — recheck availability
    const available = await isSlotAvailable(staffId, bookingDate, startMins, endMins);
    if (!available) {
      return res.status(409).json({ message: 'This time slot is no longer available. Please choose another.' });
    }

    // Amounts (in pence)
    const totalAmount   = service.price * 100;
    const depositAmount = Math.round(totalAmount * (service.depositPercentage || 0.3));

    const bookingNumber = `BK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const booking = new Booking({
      bookingNumber,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerGender,
      customerNotes,
      service:      serviceId,
      staffMember:  staffId,
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

    // ── Add event to staff's Google Calendar ─────────────────────────────
    const staff = await Staff.findById(staffId);
    if (staff) {
      const gcalEventId = await addToGoogleCalendar(staff, booking, service);
      if (gcalEventId) {
        booking.googleCalendarEventId = gcalEventId;
        await booking.save();
      }
    }

    const populated = await Booking.findById(booking._id)
      .populate('service', 'name price duration')
      .populate({
        path: 'staffMember',
        populate: { path: 'userId', select: 'firstName lastName profileImage' },
      });

    res.status(201).json(populated);
  } catch (err) {
    console.error('[createBooking]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/bookings (admin) ────────────────────────────────────────────────
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

// ─── GET /api/bookings/my (customer) ─────────────────────────────────────────
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