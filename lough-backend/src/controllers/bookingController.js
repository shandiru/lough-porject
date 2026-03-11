import Booking       from '../models/bookingModel.js';
import Staff         from '../models/staff.js';
import Service       from '../models/service.js';
import Leave         from '../models/leave.js';
import User          from '../models/user.js';
import Googlebooking from '../models/googlebooking.js';
import TempSlotLock  from '../models/tempSlotLock.js';
import { google }    from 'googleapis';
import config        from '../config/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const toMins   = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
export const fromMins = (m) => `${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;

const BUFFER = 15; // minutes buffer AFTER a booking ends before next can start

// ─── Google Calendar helper ───────────────────────────────────────────────────
export const addToGoogleCalendar = async (staff, booking, service) => {
  try {
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
    const dateStr  = new Date(booking.bookingDate).toISOString().split('T')[0];
    const startStr = `${dateStr}T${booking.bookingTime}:00`;
    const endStr   = `${dateStr}T${fromMins(toMins(booking.bookingTime) + service.duration)}:00`;

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
        colorId: '2',
      },
    });
    return event.data.id || null;
  } catch (err) {
    console.error('[Google Cal] Failed to create event:', err.message);
    return null;
  }
};

// ─── isSlotAvailable ──────────────────────────────────────────────────────────
/**
 * Fast check — all DB data is pre-fetched by the caller (getAvailableSlots)
 * and passed in. No DB calls inside this function = parallel-safe.
 *
 * Buffer rule: next booking can start at (prevEnd + BUFFER).
 * So 9–10am booked → 10:15 is the earliest next slot (10:00 + 15min buffer).
 * Trying to book at exactly 10:00 would fail (within buffer of previous end).
 */
const isSlotFreeSync = (startMins, endMins, {
  daySchedule,
  approvedLeaves,
  existingBookings,
  googleBookings,
  tempLocks,
  bookingDate,
}) => {
  // 1. Working hours
  if (!daySchedule?.isWorking) return false;
  const workStart = toMins(daySchedule.start || '09:00');
  const workEnd   = toMins(daySchedule.end   || '17:00');
  if (startMins < workStart || endMins > workEnd) return false;

  // 2. Break windows
  for (const brk of (daySchedule.breaks || [])) {
    const bS = toMins(brk.start), bE = toMins(brk.end);
    if (startMins < bE && endMins > bS) return false;
  }

  // 3. Leave (full-day already filtered out before calling; check hourly)
  for (const lv of approvedLeaves) {
    if (!lv.isHourly) return false; // full-day leave
    const lS = toMins(lv.startTime), lE = toMins(lv.endTime);
    if (startMins < lE && endMins > lS) return false;
  }

  // 4. Existing bookings + buffer
  //    A booking [bStart, bEnd] blocks [(bStart - BUFFER), (bEnd + BUFFER)]
  //    so new slot must not overlap that blocked window.
  for (const bk of existingBookings) {
    const bS = toMins(bk.bookingTime);
    const bE = bS + bk.duration;
    if (startMins < bE + BUFFER && endMins > bS - BUFFER) return false;
  }

  // 5. Google Calendar bookings + buffer
  for (const gb of googleBookings) {
    const gbS = toMins(gb.startTime), gbE = toMins(gb.endTime);
    if (startMins < gbE + BUFFER && endMins > gbS - BUFFER) return false;
  }

  // 6. TempSlotLocks (active payment holds)
  const dateStr = typeof bookingDate === 'string'
    ? bookingDate
    : new Date(bookingDate).toISOString().split('T')[0];
  for (const lock of tempLocks) {
    const lS = toMins(lock.bookingTime);
    // A lock blocks just that exact slot start — treat as BUFFER-width block
    if (startMins < lS + BUFFER && endMins > lS - BUFFER) return false;
  }

  return true;
};

// ─── GET /api/bookings/available-slots ───────────────────────────────────────
/**
 * OPTIMISED — all DB queries run in parallel per staff member,
 * then slot generation is purely synchronous.
 *
 * Query params:
 *   serviceId, date, customerGender, staffGenderPreference
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const { serviceId, date, customerGender, staffGenderPreference } = req.query;

    if (!serviceId || !date)
      return res.status(400).json({ message: 'serviceId and date are required' });

    const service = await Service.findById(serviceId);
    if (!service || !service.isActive)
      return res.status(404).json({ message: 'Service not found' });

    // Service-level gender restriction
    if (service.genderRestriction !== 'all') {
      const allowed = service.genderRestriction === 'male-only' ? 'male' : 'female';
      if (customerGender && customerGender !== allowed)
        return res.status(200).json([]);
    }

    const duration = service.duration;
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayName  = dayNames[new Date(date).getDay()];
    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999);
    const dateStr  = date; // "YYYY-MM-DD"

    // Load all eligible staff (skills match + user active)
    const allStaff = await Staff.find({ skills: serviceId })
      .populate('userId', 'firstName lastName profileImage gender isActive');

    // Filter staff by gender rules BEFORE hitting DB for slots
    const eligibleStaff = allStaff.filter(staff => {
      const u = staff.userId;
      if (!u?.isActive) return false;
      if (staff.isOnLeave) return false;
      // Staff won't serve this customer gender
      if (staff.genderRestriction === 'male-only'   && customerGender !== 'male')   return false;
      if (staff.genderRestriction === 'female-only' && customerGender !== 'female') return false;
      // Customer wants specific staff gender
      if (staffGenderPreference && staffGenderPreference !== 'any') {
        if (u.gender !== staffGenderPreference) return false;
      }
      // Must be a working day
      const ds = staff.workingHours?.[dayName];
      if (!ds?.isWorking) return false;
      return true;
    });

    if (eligibleStaff.length === 0) return res.status(200).json([]);

    // ── Fetch all DB data IN PARALLEL for all eligible staff ─────────────────
    const staffIds = eligibleStaff.map(s => s._id);

    const [allLeaves, allBookings, allGoogleBookings, allTempLocks] = await Promise.all([
      Leave.find({
        staffId:   { $in: staffIds },
        status:    'approved',
        startDate: { $lte: dayEnd },
        endDate:   { $gte: dayStart },
      }),
      Booking.find({
        staffMember: { $in: staffIds },
        bookingDate: { $gte: dayStart, $lte: dayEnd },
        status:      { $nin: ['cancelled'] },
      }),
      Googlebooking.find({
        staffId: { $in: staffIds },
        date:    { $gte: dayStart, $lte: dayEnd },
      }),
      TempSlotLock.find({
        staffId:     { $in: staffIds },
        bookingDate: dateStr,
        expiresAt:   { $gt: new Date() },
      }),
    ]);

    // Index by staffId for O(1) lookup
    const leavesByStaff   = groupBy(allLeaves,         l  => l.staffId.toString());
    const bookingsByStaff = groupBy(allBookings,        b  => b.staffMember.toString());
    const googleByStaff   = groupBy(allGoogleBookings,  g  => g.staffId.toString());
    const locksByStaff    = groupBy(allTempLocks,        l  => l.staffId.toString());

    // ── Build result synchronously ────────────────────────────────────────────
    const result = [];

    for (const staff of eligibleStaff) {
      const sid = staff._id.toString();
      const u   = staff.userId;

      // Skip if full-day leave exists
      const staffLeaves = leavesByStaff[sid] || [];
      if (staffLeaves.some(lv => !lv.isHourly)) continue;

      const daySchedule = staff.workingHours[dayName];
      const workStart   = toMins(daySchedule.start || '09:00');
      const workEnd     = toMins(daySchedule.end   || '17:00');

      const context = {
        daySchedule,
        approvedLeaves:   staffLeaves,
        existingBookings: bookingsByStaff[sid] || [],
        googleBookings:   googleByStaff[sid]   || [],
        tempLocks:        locksByStaff[sid]     || [],
        bookingDate:      dateStr,
      };

      const availableSlots = [];
      for (let t = workStart; t + duration <= workEnd; t += 15) {
        if (isSlotFreeSync(t, t + duration, context))
          availableSlots.push(fromMins(t));
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

// ─── isSlotAvailable (single-staff DB check — used for booking creation guard) ─
export const isSlotAvailable = async (staffId, date, startMins, endMins) => {
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayName  = dayNames[new Date(date).getDay()];
  const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
  const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999);
  const dateStr  = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];

  const staff = await Staff.findById(staffId);
  if (!staff || staff.isOnLeave) return false;

  const [approvedLeaves, existingBookings, googleBookings, tempLocks] = await Promise.all([
    Leave.find({ staffId, status: 'approved', startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } }),
    Booking.find({ staffMember: staffId, bookingDate: { $gte: dayStart, $lte: dayEnd }, status: { $nin: ['cancelled'] } }),
    Googlebooking.find({ staffId, date: { $gte: dayStart, $lte: dayEnd } }),
    TempSlotLock.find({ staffId, bookingDate: dateStr, expiresAt: { $gt: new Date() } }),
  ]);

  return isSlotFreeSync(startMins, endMins, {
    daySchedule:      staff.workingHours?.[dayName],
    approvedLeaves,
    existingBookings,
    googleBookings,
    tempLocks,
    bookingDate:      dateStr,
  });
};

// ─── POST /api/bookings/admin (admin direct booking — no Stripe) ──────────────
export const createBooking = async (req, res) => {
  try {
    const {
      customerName, customerEmail, customerPhone,
      customerAddress, customerGender, customerNotes,
      serviceId, staffId, bookingDate, bookingTime,
      bookingSource = 'admin', internalNotes,
      consentFormCompleted = false,
      consentData,
    } = req.body;

    const service = await Service.findById(serviceId);
    if (!service || !service.isActive)
      return res.status(404).json({ message: 'Service not found' });

    const startMins = toMins(bookingTime);
    const endMins   = startMins + service.duration;

    const available = await isSlotAvailable(staffId, bookingDate, startMins, endMins);
    if (!available)
      return res.status(409).json({ message: 'This time slot is no longer available.' });

    const totalAmount   = service.price * 100;
    const depositAmount = Math.round(totalAmount * (service.depositPercentage || 0.3));
    const bookingNumber = `BK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000+Math.random()*9000)}`;

    const booking = await Booking.create({
      bookingNumber,
      customerName, customerEmail, customerPhone,
      customerAddress, customerGender, customerNotes,
      service:     serviceId,
      staffMember: staffId,
      bookingDate: new Date(bookingDate),
      bookingTime,
      duration:    service.duration,
      status:      'confirmed',
      totalAmount,
      depositAmount,
      paidAmount:       0,
      balanceRemaining: totalAmount,
      paymentType:      'deposit',
      paymentStatus:    'pending',
      consentFormCompleted,
      consentData: consentData || { marketingEmails: false, termsAccepted: false, privacyPolicyAccepted: false },
      bookingSource,
      internalNotes,
      createdBy: req.user?.id || null,
    });

    const staff = await Staff.findById(staffId);
    if (staff) {
      const gcalEventId = await addToGoogleCalendar(staff, booking, service);
      if (gcalEventId) { booking.googleCalendarEventId = gcalEventId; await booking.save(); }
    }

    const populated = await Booking.findById(booking._id)
      .populate('service', 'name price duration')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } });

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
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } })
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
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } })
      .sort({ bookingDate: -1 });
    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Utility ──────────────────────────────────────────────────────────────────
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}
