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
const TZ = 'Asia/Colombo'; // Sri Lanka Standard Time (UTC+5:30)

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const toMins   = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
export const fromMins = (m) => `${Math.floor(m/60).toString().padStart(2,'0')}:${(m%60).toString().padStart(2,'0')}`;

/**
 * Build a Date representing midnight (00:00:00.000) at the START of a given
 * "YYYY-MM-DD" string in Sri Lanka time.
 * Stored as UTC in MongoDB — day-boundary queries are correct.
 */
export const colomboDayStart = (dateStr) => new Date(`${dateStr}T00:00:00+05:30`);
export const colomboDayEnd   = (dateStr) => new Date(`${dateStr}T23:59:59.999+05:30`);

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
        // ✅ FIX: was 'Europe/London' → now Asia/Colombo
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
   console.log("review cancel  phase 4")
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
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

    // ✅ FIX: parse day-of-week at noon Colombo time (avoids midnight UTC boundary issues)
    const dayName  = dayNames[new Date(`${date}T12:00:00+05:30`).getDay()];

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
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  // ✅ FIX: noon Colombo time for correct day-of-week
  const dayName  = dayNames[new Date(`${date}T12:00:00+05:30`).getDay()];
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
  console.log("review cancel ");
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

    let stripeRefundId = null;
    if (refundAmount > 0 && booking.stripePaymentIntentId) {
       console.log("review cancel phase 2")
      try {
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(config.stripe.secretKey);
        const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
        stripeRefundId = refund.id;
      } catch (stripeErr) {
        console.error('[Stripe refund]', stripeErr.message);
        return res.status(502).json({ message: 'Stripe refund failed: ' + stripeErr.message });
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

    // ✅ FIX: refund record Payment collection-ல store
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

    // ✅ FIX: Google Calendar event delete பண்ணு
    if (booking.googleCalendarEventId) {
       console.log("review cancel phase3 ")
      const staffId = booking.staffMember?._id ?? booking.staffMember;
      const staff   = await Staff.findById(staffId).catch(() => null);
      if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
    }

    res.status(200).json({
      message: stripeRefunded ? `Booking cancelled and £${(refundAmount/100).toFixed(2)} refunded` : 'Booking cancelled (no refund)',
      booking,
    });
  } catch (err) {
    console.error('[reviewCancellation]', err);
    res.status(500).json({ message: err.message });
  }
};

// ─── PATCH /api/bookings/:id/status (admin) ───────────────────────────────────
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, internalNotes } = req.body;
    const allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status, ...(internalNotes && { internalNotes }) },
      { new: true }
    ).populate('service', 'name price duration')
     .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // ✅ FIX: status 'cancelled' ஆனா Google Calendar event delete பண்ணு
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
    const { refundAmount = 0, reason = '', internalNotes = '' } = req.body;
    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name price duration')
      .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });

    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (['cancelled', 'completed', 'no-show'].includes(booking.status))
      return res.status(400).json({ message: `Cannot cancel a ${booking.status} booking` });

    let stripeRefundId = null;
    if (refundAmount > 0 && booking.stripePaymentIntentId) {
      try {
        const stripe = (await import('stripe')).default(config.stripe.secretKey);
        const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
        stripeRefundId = refund.id;
      } catch (stripeErr) {
        console.error('[Stripe refund]', stripeErr.message);
        return res.status(502).json({ message: 'Stripe refund failed: ' + stripeErr.message });
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

    // ✅ FIX: refund record Payment collection-ல store
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

    // ✅ FIX: Google Calendar event delete பண்ணு
    // booking.staffMember is already a populated Staff doc OR raw ObjectId —
    // always do a fresh findById so googleCalendarToken is guaranteed to be present
    if (booking.googleCalendarEventId) {
      const staffId = booking.staffMember?._id ?? booking.staffMember;
      const staff   = await Staff.findById(staffId).catch(() => null);
      if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
    }

    res.status(200).json({
      booking,
      message: stripeRefunded
        ? `Booking cancelled and £${(refundAmount / 100).toFixed(2)} refunded`
        : 'Booking cancelled',
    });
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
