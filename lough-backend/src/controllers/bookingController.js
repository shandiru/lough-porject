import Booking       from '../models/bookingModel.js';
import Staff         from '../models/staff.js';
import Service       from '../models/service.js';
import Leave         from '../models/leave.js';
import User          from '../models/user.js';
import Payment       from '../models/paymentModel.js';
import config        from '../config/index.js';
import Googlebooking from '../models/googlebooking.js';
import TempSlotLock  from '../models/tempSlotLock.js';
import { google }    from 'googleapis';

// ─── Timezone ─────────────────────────────────────────────────────────────────
// Timezone is now configured via APP_TIMEZONE in .env (see src/utils/timezone.js)
import { TZ, tzDayStart, tzDayEnd, dayName as tzDayName, formatDate as tzFormatDate } from '../utils/timezone.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const toMins   = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
export const fromMins = (m) => `${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;

/**
 * Build a Date representing midnight (00:00:00.000) at the START of a given
 * "YYYY-MM-DD" string in the configured timezone.
 * Stored as UTC in MongoDB — day-boundary queries are correct.
 */
export const colomboDayStart = (dateStr) => tzDayStart(dateStr);
export const colomboDayEnd   = (dateStr) => tzDayEnd(dateStr);

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

    // bookingDate is stored as UTC in Mongo — render it in Colombo TZ for the date string
    const dateStr  = new Date(booking.bookingDate).toLocaleDateString('en-CA', { timeZone: TZ });
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
        // timeZone uses TZ from .env (APP_TIMEZONE)
        start: { dateTime: startStr, timeZone: TZ },
        end:   { dateTime: endStr,   timeZone: TZ },
        colorId: '2',
      },
    });
    return event.data.id || null;
  } catch (err) {
    console.error('[Google Cal] Failed to create event:', err.message);
    return null;
  }
};

// ─── deleteFromGoogleCalendar helper ─────────────────────────────────────────
/**
 * Deletes a Google Calendar event for a staff member.
 * Called when a booking is cancelled (any flow).
 * Non-fatal — errors are logged but never bubble up.
 */
export const deleteFromGoogleCalendar = async (staff, googleCalendarEventId) => {
  try {
    if (!googleCalendarEventId) {
      console.log('[Google Cal Delete] Skipped — no googleCalendarEventId on booking');
      return;
    }
    if (!staff.googleCalendarToken?.access_token || !staff.googleCalendarToken?.refresh_token) {
      console.log('[Google Cal Delete] Skipped — staff has no calendar token, staffId:', staff._id);
      return;
    }
    if (staff.googleCalendarSyncStatus?.status !== 'connected') {
      console.log('[Google Cal Delete] Skipped — calendar not connected, status:', staff.googleCalendarSyncStatus?.status, 'staffId:', staff._id);
      return;
    }

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
    await calendar.events.delete({
      calendarId: staff.googleCalendarId || 'primary',
      eventId:    googleCalendarEventId,
    });
    console.log('[Google Cal] Event deleted:', googleCalendarEventId);
  } catch (err) {
    // 410 Gone = already deleted — not an error
    if (err.code === 410 || err.status === 410) {
      console.log('[Google Cal] Event already gone:', googleCalendarEventId);
    } else {
      console.error('[Google Cal] Failed to delete event:', err.message);
    }
  }
};

// ─── isSlotFreeSync ───────────────────────────────────────────────────────────
/**
 * Buffer rule: next booking can start only AFTER (prevEnd + BUFFER).
 * Example: 9:00–9:30 booked (30min) → 9:30 + 15min buffer = 9:45 earliest next slot.
 * Buffer applies AFTER end only — NOT before booking starts.
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

  // 2. Breaks
  for (const brk of (daySchedule.breaks || [])) {
    const bS = toMins(brk.start), bE = toMins(brk.end);
    if (startMins < bE && endMins > bS) return false;
  }

  // 3. Hourly leave
  for (const lv of approvedLeaves) {
    if (!lv.isHourly) return false;
    const lS = toMins(lv.startTime), lE = toMins(lv.endTime);
    if (startMins < lE && endMins > lS) return false;
  }

  // 4. Existing bookings + post-end buffer
  // ✅ FIX: endMins > bS (not bS - BUFFER — no pre-booking buffer)
  for (const bk of existingBookings) {
    const bS = toMins(bk.bookingTime);
    const bE = bS + bk.duration;
    if (startMins < bE + BUFFER && endMins > bS) return false;
  }

  // 5. Google Calendar bookings + post-end buffer
  // ✅ FIX: endMins > gbS (not gbS - BUFFER)
  for (const gb of googleBookings) {
    const gbS = toMins(gb.startTime), gbE = toMins(gb.endTime);
    if (startMins < gbE + BUFFER && endMins > gbS) return false;
  }

  // 6. TempSlotLocks + post-end buffer
  // ✅ FIX: use lock.duration for real end time; no pre-lock buffer
  const dateStr = typeof bookingDate === 'string'
    ? bookingDate
    : new Date(bookingDate).toLocaleDateString('en-CA', { timeZone: TZ });
  for (const lock of tempLocks) {
    if (lock.bookingDate !== dateStr) continue;
    const lS = toMins(lock.bookingTime);
    const lE = lS + (lock.duration || 0);
    if (startMins < lE + BUFFER && endMins > lS) return false;
  }

  return true;
};

// ─── GET /api/bookings/available-slots ───────────────────────────────────────
export const getAvailableSlots = async (req, res) => {
  try {
    const { serviceId, date, customerGender, staffGenderPreference } = req.query;

    if (!serviceId || !date)
      return res.status(400).json({ message: 'serviceId and date are required' });

    const service = await Service.findById(serviceId);
    if (!service || !service.isActive)
      return res.status(404).json({ message: 'Service not found' });

    if (service.genderRestriction !== 'all') {
      const allowed = service.genderRestriction === 'male-only' ? 'male' : 'female';
      if (customerGender && customerGender !== allowed)
        return res.status(200).json([]);
    }

    const duration = service.duration;
    // Parse day-of-week at noon in configured timezone (avoids midnight UTC boundary issues)
    const dayName  = tzDayName(date);


    // ✅ FIX: day boundaries in Colombo time
    const dayStart = colomboDayStart(date);
    const dayEnd   = colomboDayEnd(date);
    const dateStr  = date;

    const allStaff = await Staff.find({ skills: serviceId })
      .populate('userId', 'firstName lastName profileImage gender isActive');

    const eligibleStaff = allStaff.filter(staff => {
      const u = staff.userId;
      if (!u?.isActive) return false;
      if (staff.isOnLeave) return false;
      if (staff.genderRestriction === 'male-only'   && customerGender !== 'male')   return false;
      if (staff.genderRestriction === 'female-only' && customerGender !== 'female') return false;
      if (staffGenderPreference && staffGenderPreference !== 'any') {
        if (u.gender !== staffGenderPreference) return false;
      }
      const ds = staff.workingHours?.[dayName];
      if (!ds?.isWorking) return false;
      return true;
    });

    if (eligibleStaff.length === 0) return res.status(200).json([]);

    const staffIds = eligibleStaff.map(s => s._id);

    const [allLeaves, allBookings, allGoogleBookings, allTempLocks] = await Promise.all([
      Leave.find({ staffId: { $in: staffIds }, status: 'approved', startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } }),
      Booking.find({ staffMember: { $in: staffIds }, bookingDate: { $gte: dayStart, $lte: dayEnd }, status: { $nin: ['cancelled'] } }),
      Googlebooking.find({ staffId: { $in: staffIds }, date: { $gte: dayStart, $lte: dayEnd } }),
      TempSlotLock.find({ staffId: { $in: staffIds }, bookingDate: dateStr, expiresAt: { $gt: new Date() } }),
    ]);

    const leavesByStaff   = groupBy(allLeaves,         l => l.staffId.toString());
    const bookingsByStaff = groupBy(allBookings,        b => b.staffMember.toString());
    const googleByStaff   = groupBy(allGoogleBookings,  g => g.staffId.toString());
    const locksByStaff    = groupBy(allTempLocks,        l => l.staffId.toString());

    const result = [];

    for (const staff of eligibleStaff) {
      const sid = staff._id.toString();
      const u   = staff.userId;

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

// ─── isSlotAvailable (single-staff DB check) ─────────────────────────────────
export const isSlotAvailable = async (staffId, date, startMins, endMins) => {
  // Noon in configured timezone for correct day-of-week
  const dayName  = tzDayName(date);
  const dayStart = colomboDayStart(date);
  const dayEnd   = colomboDayEnd(date);
  const dateStr  = typeof date === 'string' ? date : new Date(date).toLocaleDateString('en-CA', { timeZone: TZ });

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

// ─── POST /api/bookings/admin ─────────────────────────────────────────────────
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

    // ── Validate booking date — must be tomorrow or later ──────────────────
    if (bookingDate) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      if (bookingDate <= todayStr) {
        return res.status(400).json({
          message: 'Booking date must be at least 1 day in the future. Same-day bookings are not accepted.',
        });
      }
    }

    // ── Validate UK phone number ───────────────────────────────────────────
    if (customerPhone) {
      const stripped = customerPhone.replace(/[\s\-().]/g, '');
      const isUKPhone =
        /^07\d{9}$/.test(stripped) ||
        /^\+447\d{9}$/.test(stripped) ||
        /^0[1-3]\d{8,9}$/.test(stripped) ||
        /^\+44[1-3]\d{8,9}$/.test(stripped);
      if (!isUKPhone) {
        return res.status(400).json({
          message: 'Please provide a valid UK phone number (e.g. 07700 900000).',
        });
      }
    }

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
      // ✅ FIX: store as Colombo midnight
      bookingDate: colomboDayStart(bookingDate),
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

// ─── POST /api/bookings/:id/cancel-request (customer) ────────────────────────
export const requestCancellation = async (req, res) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const user = await User.findById(req.user.id);
    if (!user || user.email.toLowerCase() !== booking.customerEmail.toLowerCase())
      return res.status(403).json({ message: 'Not authorised' });

    if (['cancelled', 'completed', 'no-show'].includes(booking.status))
      return res.status(400).json({ message: `Cannot cancel a ${booking.status} booking` });

    if (booking.cancelRequestStatus === 'pending')
      return res.status(400).json({ message: 'Cancellation request already pending' });

    booking.cancelRequestedAt   = new Date();
    booking.cancelRequestedBy   = req.user.id;
    booking.cancelRequestReason = reason || '';
    booking.cancelRequestStatus = 'pending';
    await booking.save();

    res.status(200).json({ message: 'Cancellation request submitted', booking });
  } catch (err) {
    console.error('[requestCancellation]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/bookings/:id/cancel-review (admin) ────────────────────────────
export const reviewCancellation = async (req, res) => {
  try {
    const { action, refundAmount = 0, adminNote } = req.body;
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ message: 'action must be approve or reject' });

    const booking = await Booking.findById(req.params.id).populate('service');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.cancelRequestStatus !== 'pending')
      return res.status(400).json({ message: 'No pending cancel request on this booking' });

    if (action === 'reject') {
      booking.cancelRequestStatus = 'rejected';
      if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Cancel rejected] ${adminNote}`;
      await booking.save();
      return res.status(200).json({ message: 'Cancellation request rejected', booking });
    }

    // ── Stripe refund (optional — failure does NOT block cancel or gcal delete) ─
    let stripeRefundId = null;
    let stripeErrMsg   = null;
    if (refundAmount > 0 && booking.stripePaymentIntentId) {
      try {
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(config.stripe.secretKey);
        const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
        stripeRefundId = refund.id;
        console.log('[Stripe refund] Success:', stripeRefundId);
      } catch (stripeErr) {
        // Log but DO NOT return — booking cancel + gcal delete must still happen
        stripeErrMsg = stripeErr.message;
        console.error('[Stripe refund] Failed (continuing with cancel):', stripeErrMsg);
      }
    }

    const stripeRefunded = !!stripeRefundId;

    booking.status               = 'cancelled';
    booking.cancelRequestStatus  = 'approved';
    booking.cancelledAt          = new Date();
    booking.cancelledBy          = req.user.id;
    booking.cancellationReason   = booking.cancelRequestReason;
    if (stripeRefunded) {
      booking.refundAmount   = refundAmount;
      booking.refundedAt     = new Date();
      booking.paymentStatus  = refundAmount >= booking.paidAmount ? 'refunded' : 'partially_refunded';
      booking.paidAmount     = booking.paidAmount - refundAmount;
    }
    if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Cancel approved] ${adminNote}`;
    await booking.save();

    // ── Payment refund record ─────────────────────────────────────────────────
    if (stripeRefunded) {
      await Payment.create({
        booking:             booking._id,
        amount:              refundAmount,
        type:                'refund',
        status:              'success',
        stripeTransactionId: stripeRefundId,
        processedAt:         new Date(),
        processedBy:         req.user.id,
      }).catch(err => console.error('[Payment refund record]', err.message));
    }

    // ── Google Calendar event delete (always runs, even if refund failed) ─────
    if (booking.googleCalendarEventId) {
      console.log('[Google Cal Delete] Attempting for eventId:', booking.googleCalendarEventId);
      const staffId = booking.staffMember?._id ?? booking.staffMember;
      const staff   = await Staff.findById(staffId).catch(() => null);
      if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
    }

    // ── Response ──────────────────────────────────────────────────────────────
    let message = 'Booking cancelled (no refund)';
    if (stripeRefunded) message = `Booking cancelled and £${(refundAmount/100).toFixed(2)} refunded`;
    if (stripeErrMsg)   message = `Booking cancelled but refund failed: ${stripeErrMsg}`;

    res.status(200).json({ message, booking });
  } catch (err) {
    console.error('[reviewCancellation]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── PATCH /api/bookings/:id/status (admin) ───────────────────────────────────
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, internalNotes, balanceReceived } = req.body;
    const allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name price duration')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    booking.status = status;
    if (internalNotes) booking.internalNotes = internalNotes;

    // ── When marking as completed, record any balance payment collected in-person ─
    if (status === 'completed' && balanceReceived !== undefined) {
      const balancePence = Math.round(parseFloat(balanceReceived) * 100);
      if (balancePence > 0) {
        booking.paidAmount       = (booking.paidAmount || 0) + balancePence;
        booking.balanceRemaining = Math.max((booking.balanceRemaining || 0) - balancePence, 0);
        if (booking.balanceRemaining === 0) {
          booking.paymentStatus = 'paid';
        }
      }
    }

    await booking.save();

    // ── status 'cancelled' ஆனா Google Calendar event delete பண்ணு ──────────
    if (status === 'cancelled' && booking.googleCalendarEventId) {
      const staff = await Staff.findById(booking.staffMember._id || booking.staffMember).catch(() => null);
      if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
    }

    res.status(200).json(booking);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/bookings/:id/admin-cancel ─────────────────────────────────────
export const adminCancelBooking = async (req, res) => {
  try {
    const { refundAmount = 0, reason = '', internalNotes = '', refundKey = '' } = req.body;

    // ── Refund key guard — required when a refund amount is specified ─────────
    if (refundAmount > 0) {
      const expectedKey = config.adminRefundKey;
      if (!expectedKey) {
        return res.status(500).json({ message: 'ADMIN_REFUND_KEY is not configured on the server.' });
      }
      if (refundKey !== expectedKey) {
        return res.status(403).json({ message: 'Invalid refund key. Refund not authorised.' });
      }
    }
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name price duration')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });

    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (['cancelled', 'completed', 'no-show'].includes(booking.status))
      return res.status(400).json({ message: `Cannot cancel a ${booking.status} booking` });

    // ── Stripe refund (optional — failure does NOT block cancel or gcal delete) ─
    let stripeRefundId = null;
    let stripeErrMsg   = null;
    if (refundAmount > 0 && booking.stripePaymentIntentId) {
      try {
        const stripe = (await import('stripe')).default(config.stripe.secretKey);
        const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
        stripeRefundId = refund.id;
        console.log('[Stripe refund] Success:', stripeRefundId);
      } catch (stripeErr) {
        stripeErrMsg = stripeErr.message;
        console.error('[Stripe refund] Failed (continuing with cancel):', stripeErrMsg);
      }
    }

    const stripeRefunded = !!stripeRefundId;

    booking.status             = 'cancelled';
    booking.cancelledAt        = new Date();
    booking.cancelledBy        = req.user.id;
    booking.cancellationReason = reason;
    if (internalNotes) booking.internalNotes = internalNotes;
    if (stripeRefunded) {
      booking.refundAmount  = refundAmount;
      booking.refundedAt    = new Date();
      booking.paymentStatus = refundAmount >= booking.paidAmount ? 'refunded' : 'partially_refunded';
      booking.paidAmount    = booking.paidAmount - refundAmount;
    }
    await booking.save();

    // ── Payment refund record ─────────────────────────────────────────────────
    if (stripeRefunded) {
      await Payment.create({
        booking:             booking._id,
        amount:              refundAmount,
        type:                'refund',
        status:              'success',
        stripeTransactionId: stripeRefundId,
        processedAt:         new Date(),
        processedBy:         req.user.id,
      }).catch(err => console.error('[Payment refund record]', err.message));
    }

    // ── Google Calendar event delete (always runs, even if refund failed) ─────
    if (booking.googleCalendarEventId) {
      console.log('[Google Cal Delete] Attempting for eventId:', booking.googleCalendarEventId);
      const staffId = booking.staffMember?._id ?? booking.staffMember;
      const staff   = await Staff.findById(staffId).catch(() => null);
      if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
    }

    let message = 'Booking cancelled';
    if (stripeRefunded) message = `Booking cancelled and £${(refundAmount / 100).toFixed(2)} refunded`;
    if (stripeErrMsg)   message = `Booking cancelled but refund failed: ${stripeErrMsg}`;

    res.status(200).json({ booking, message });
  } catch (err) {
    console.error('[adminCancelBooking]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/bookings/calendar (admin calendar view) ────────────────────────
export const getCalendarBookings = async (req, res) => {
  try {
    const { startDate, endDate, staffId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'startDate and endDate required' });

    // ✅ FIX: boundaries in Colombo time
    const query = {
      bookingDate: { $gte: colomboDayStart(startDate), $lte: colomboDayEnd(endDate) },
      status: { $nin: ['cancelled'] },
    };
    if (staffId) query.staffMember = staffId;

    const bookings = await Booking.find(query)
      .populate('service', 'name price duration color')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } })
      .sort({ bookingDate: 1, bookingTime: 1 });

    const googleQuery = { date: { $gte: colomboDayStart(startDate), $lte: colomboDayEnd(endDate) } };
    if (staffId) googleQuery.staffId = staffId;
    const googleBookings = await Googlebooking.find(googleQuery)
      .populate({ path: 'staffId', populate: { path: 'userId', select: 'firstName lastName' } });

    res.status(200).json({ bookings, googleBookings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/bookings/staff/my (staff — their own bookings) ─────────────────
/**
 * Staff member-ஓட own bookings fetch பண்ணும்.
 * req.user.id = User._id (JWT-ல இருக்கு)
 * Booking.staffMember = Staff._id  ← இரண்டும் different!
 * Fix: User._id → Staff._id → Bookings
 */
export const getStaffBookings = async (req, res) => {
  try {
    // Step 1: User._id → Staff record find பண்ணு
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

    // Step 2: Staff._id-ல bookings fetch பண்ணு
    const bookings = await Booking.find({ staffMember: staff._id })
      .populate('service', 'name price duration color')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } })
      .sort({ bookingDate: -1 });

    res.status(200).json(bookings);
  } catch (err) {
    console.error('[getStaffBookings]', err);
    res.status(500).json({ message: err.message });
  }
};
// ─── POST /api/bookings/:id/consultation-form ─────────────────────────────────
/**
 * Customer submits the consultation form AFTER payment.
 * - Form data is NOT stored in DB (privacy).
 * - Sets consultationFormCompleted = true on the booking.
 * - Sends email to admin + assigned staff with form data.
 */
export const submitConsultationForm = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName email' } });

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Only the customer who owns this booking can submit
    if (booking.customerEmail.toLowerCase() !== (req.user?.email || '').toLowerCase()) {
      
      return res.status(403).json({ message: 'Not authorised' });
    }

    if (booking.consultationFormCompleted) {
      return res.status(400).json({ message: 'Consultation form already submitted' });
    }

    const {
      fullName, dateOfBirth, age, address, phone, email,
      emergencyContact,
      medicalHistory = [],
      currentMedications, pastSurgeries, treatmentAreasOfInterest,
      signature,
    } = req.body;

    // Mark as completed (don't store form data)
    booking.consultationFormCompleted = true;
    await booking.save();

    // ── Send email to admin + staff ──────────────────────────────────────────
    try {
      const nodemailer = (await import('nodemailer')).default;
      const cfg        = (await import('../config/index.js')).default;

      const mailer = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: cfg.email.user, pass: cfg.email.pass },
      });

      // Collect recipient emails: all admins + assigned staff
      const User   = (await import('../models/user.js')).default;
      const admins = await User.find({ role: 'admin', isActive: true }).select('email');
      const staffEmail = booking.staffMember?.userId?.email;

      const recipients = [
        ...admins.map(a => a.email),
        ...(staffEmail ? [staffEmail] : []),
      ].filter(Boolean);

      const medList = medicalHistory.length
        ? medicalHistory.map(h => `<li>${h}</li>`).join('')
        : '<li>None selected</li>';

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
          <div style="background:linear-gradient(135deg,#22B8C8 0%,#1a9aad 100%);padding:28px 32px;text-align:center;border-radius:12px 12px 0 0">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Client Consultation Form</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber} · ${booking.service?.name || ''}</p>
          </div>
          <div style="background:#fafafa;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none">
            <p style="font-size:12px;color:#aaa;margin-top:0">Submitted by customer. Form data is NOT stored on server (privacy).</p>

            <p style="font-weight:700;color:#22B8C8;font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px">Personal Details</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden">
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555;width:38%">Full Name</td><td style="padding:8px 12px">${fullName || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555">Date of Birth</td><td style="padding:8px 12px">${dateOfBirth || '—'}</td></tr>
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555">Age</td><td style="padding:8px 12px">${age || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555">Address</td><td style="padding:8px 12px">${address || '—'}</td></tr>
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555">Phone</td><td style="padding:8px 12px">${phone || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555">Email</td><td style="padding:8px 12px">${email || '—'}</td></tr>
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555">Emergency Contact</td><td style="padding:8px 12px">${emergencyContact || '—'}</td></tr>
            </table>

            <p style="font-weight:700;color:#22B8C8;font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px">Medical History</p>
            <ul style="margin:0;padding-left:20px;font-size:13px;color:#444">${medList}</ul>

            <p style="font-weight:700;color:#22B8C8;font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px">Additional Information</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden">
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555;width:38%">Current Medications</td><td style="padding:8px 12px">${currentMedications || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555">Past Surgeries</td><td style="padding:8px 12px">${pastSurgeries || '—'}</td></tr>
              <tr style="background:#f0fafa"><td style="padding:8px 12px;font-weight:600;color:#555">Treatment Areas of Interest</td><td style="padding:8px 12px">${treatmentAreasOfInterest || '—'}</td></tr>
            </table>

            <p style="font-weight:700;color:#22B8C8;font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px">E-Signature</p>
            <p style="font-size:13px;background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-style:italic;color:#92400e">"${signature || '—'}"</p>

            <p style="font-size:11px;color:#bbb;margin-top:24px;text-align:center">Lough Skin · Automated consultation form notification</p>
          </div>
        </div>`;

      await mailer.sendMail({
        from:    `"Lough Skin" <${cfg.email.user}>`,
        to:      recipients,
        subject: `[Consultation Form] ${booking.customerName} — ${booking.bookingNumber}`,
        html,
      });
      console.log('[Consultation Form Email] Sent to:', recipients.join(', '));
    } catch (emailErr) {
      console.error('[Consultation Form Email] Failed:', emailErr.message);
      // Don't fail the request if email fails
    }

    res.status(200).json({ message: 'Consultation form submitted successfully', consultationFormCompleted: true });
  } catch (err) {
    console.error('[submitConsultationForm]', err);
    res.status(500).json({ message: err.message });
  }
};
