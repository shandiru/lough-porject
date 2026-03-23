// controllers/bookingController.js
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
import { sendMail }  from '../utils/mailer.js';                          // ✅ Singleton
import {
    formatDate,
    adminCreateStaffTemplate,
    adminCreateCustomerTemplate,
    cancelApprovedCustomerTemplate,
    cancelApprovedStaffTemplate,
    adminCancelCustomerTemplate,
    adminCancelStaffTemplate,
    rescheduleNewStaffTemplate,
    rescheduleOldStaffTemplate,
    rescheduleCustomerTemplate,
    rescheduleAdminTemplate,
    consultationFormTemplate,
} from '../utils/bookingControllerTemplates.js';                          // ✅ Templates

import { TZ, tzDayStart, tzDayEnd, dayName as tzDayName } from '../utils/timezone.js';
import { writeAuditLog } from '../utils/auditLogger.js';

export const toMins   = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMins = (m) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;

export const colomboDayStart = (dateStr) => tzDayStart(dateStr);
export const colomboDayEnd   = (dateStr) => tzDayEnd(dateStr);

const BUFFER = 15;

// ─── Google Calendar ──────────────────────────────────────────────────────────
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

export const deleteFromGoogleCalendar = async (staff, googleCalendarEventId) => {
    try {
        if (!googleCalendarEventId) return;
        if (!staff.googleCalendarToken?.access_token || !staff.googleCalendarToken?.refresh_token) return;
        if (staff.googleCalendarSyncStatus?.status !== 'connected') return;

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
        if (err.code === 410 || err.status === 410) {
            console.log('[Google Cal] Event already gone:', googleCalendarEventId);
        } else {
            console.error('[Google Cal] Failed to delete event:', err.message);
        }
    }
};

// ─── Slot availability ────────────────────────────────────────────────────────
const isSlotFreeSync = (startMins, endMins, {
    daySchedule, approvedLeaves, existingBookings, googleBookings, tempLocks, bookingDate,
}) => {
    if (!daySchedule?.isWorking) return false;
    const workStart = toMins(daySchedule.start || '09:00');
    const workEnd   = toMins(daySchedule.end   || '17:00');
    if (startMins < workStart || endMins > workEnd) return false;

    for (const brk of (daySchedule.breaks || [])) {
        const bS = toMins(brk.start), bE = toMins(brk.end);
        if (startMins < bE && endMins > bS) return false;
    }

    for (const lv of approvedLeaves) {
        if (!lv.isHourly) return false;
        const lS = toMins(lv.startTime), lE = toMins(lv.endTime);
        if (startMins < lE && endMins > lS) return false;
    }

    for (const bk of existingBookings) {
        const bS = toMins(bk.bookingTime);
        const bE = bS + bk.duration;
        if (startMins < bE + BUFFER && endMins > bS) return false;
    }

    for (const gb of googleBookings) {
        const gbS = toMins(gb.startTime), gbE = toMins(gb.endTime);
        if (startMins < gbE + BUFFER && endMins > gbS) return false;
    }

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

// ─── Utility ──────────────────────────────────────────────────────────────────
function groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
        const k = keyFn(item);
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}

// ─── GET /api/bookings/available-slots ───────────────────────────────────────
export const getAvailableSlots = async (req, res) => {
    try {
        const { serviceId, date, customerGender, staffGenderPreference, excludeBookingId } = req.query;

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
        const dayName  = tzDayName(date);
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
            Booking.find({ staffMember: { $in: staffIds }, bookingDate: { $gte: dayStart, $lte: dayEnd }, status: { $nin: ['cancelled'] }, ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}) }),
            Googlebooking.find({ staffId: { $in: staffIds }, date: { $gte: dayStart, $lte: dayEnd } }),
            TempSlotLock.find({ staffId: { $in: staffIds }, bookingDate: dateStr, expiresAt: { $gt: new Date() } }),
        ]);

        const leavesByStaff   = groupBy(allLeaves,        l => l.staffId.toString());
        const bookingsByStaff = groupBy(allBookings,       b => b.staffMember.toString());
        const googleByStaff   = groupBy(allGoogleBookings, g => g.staffId.toString());
        const locksByStaff    = groupBy(allTempLocks,      l => l.staffId.toString());

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
                        _id:             staff._id,
                        name:            `${u.firstName} ${u.lastName}`,
                        gender:          u.gender,
                        profileImage:    u.profileImage || null,
                        specializations: staff.specializations || [],
                        bio:             staff.bio || '',
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

// ─── isSlotAvailable ──────────────────────────────────────────────────────────
export const isSlotAvailable = async (staffId, date, startMins, endMins) => {
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
            consentFormCompleted = false, consentData,
        } = req.body;

        if (bookingDate) {
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
            if (bookingDate <= todayStr)
                return res.status(400).json({ message: 'Booking date must be at least 1 day in the future. Same-day bookings are not accepted.' });
        }

        if (customerPhone) {
            const stripped = customerPhone.replace(/[\s\-().]/g, '');
            const isUKPhone =
                /^07\d{9}$/.test(stripped)         ||
                /^\+447\d{9}$/.test(stripped)      ||
                /^0[1-3]\d{8,9}$/.test(stripped)   ||
                /^\+44[1-3]\d{8,9}$/.test(stripped);
            if (!isUKPhone)
                return res.status(400).json({ message: 'Please provide a valid UK phone number (e.g. 07700 900000).' });
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
        const bookingNumber = `BK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        const booking = await Booking.create({
            bookingNumber,
            customerName, customerEmail, customerPhone,
            customerAddress, customerGender, customerNotes,
            service:     serviceId,
            staffMember: staffId,
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
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage email' } });

        // ── Emails ────────────────────────────────────────────────────────────
        try {
            const staffUser     = populated.staffMember?.userId;
            const staffName     = staffUser ? `${staffUser.firstName} ${staffUser.lastName}` : 'Staff';
            const staffEmail    = staffUser?.email || null;
            const formattedDate = formatDate(booking.bookingDate);

            await Promise.all([
                staffEmail
                    ? sendMail(staffEmail, adminCreateStaffTemplate(booking, service, staffName, formattedDate))
                    : Promise.resolve(),
                sendMail(customerEmail, adminCreateCustomerTemplate(booking, service, staffName, formattedDate)),
            ]);
            console.log('[createBooking Emails] Sent to staff and customer');
        } catch (emailErr) {
            console.error('[createBooking Email] Failed:', emailErr.message);
        }

        await writeAuditLog({
            user: req.user,
            entity: 'booking',
            entityId: booking._id,
            action: 'booking.created',
            description: `Admin created booking ${booking.bookingNumber} for ${customerName} — ${service?.name || ''} on ${bookingDate} at ${bookingTime}`,
            after: { bookingNumber: booking.bookingNumber, customerName, customerEmail, bookingDate, bookingTime, service: serviceId, staffMember: staffId },
            req,
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

        // ── Stripe refund ─────────────────────────────────────────────────────
        let stripeRefundId = null, stripeErrMsg = null;
        if (refundAmount > 0 && booking.stripePaymentIntentId) {
            try {
                const { default: Stripe } = await import('stripe');
                const stripe = new Stripe(config.stripe.secretKey);
                const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
                stripeRefundId = refund.id;
            } catch (stripeErr) {
                stripeErrMsg = stripeErr.message;
                console.error('[Stripe refund] Failed (continuing with cancel):', stripeErrMsg);
            }
        }

        const stripeRefunded = !!stripeRefundId;

        booking.status              = 'cancelled';
        booking.cancelRequestStatus = 'approved';
        booking.cancelledAt         = new Date();
        booking.cancelledBy         = req.user.id;
        booking.cancellationReason  = booking.cancelRequestReason;
        if (stripeRefunded) {
            booking.refundAmount   = refundAmount;
            booking.refundedAt     = new Date();
            booking.paymentStatus  = refundAmount >= booking.paidAmount ? 'refunded' : 'partially_refunded';
            booking.paidAmount     = booking.paidAmount - refundAmount;
        }
        if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Cancel approved] ${adminNote}`;
        await booking.save();

        if (stripeRefunded) {
            await Payment.create({
                booking: booking._id, amount: refundAmount, type: 'refund', status: 'success',
                stripeTransactionId: stripeRefundId, processedAt: new Date(), processedBy: req.user.id,
            }).catch(err => console.error('[Payment refund record]', err.message));
        }

        if (booking.googleCalendarEventId) {
            const staffId = booking.staffMember?._id ?? booking.staffMember;
            const staff   = await Staff.findById(staffId).catch(() => null);
            if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
        }

        // ── Emails ────────────────────────────────────────────────────────────
        try {
            const staffFullDoc    = await Staff.findById(booking.staffMember?._id ?? booking.staffMember).populate('userId', 'firstName lastName email').catch(() => null);
            const staffName       = staffFullDoc?.userId ? `${staffFullDoc.userId.firstName} ${staffFullDoc.userId.lastName}` : 'Staff';
            const staffEmailFinal = staffFullDoc?.userId?.email || null;
            const formattedDate   = formatDate(booking.bookingDate);

            await Promise.all([
                sendMail(booking.customerEmail, cancelApprovedCustomerTemplate(booking, formattedDate, refundAmount, stripeRefunded)),
                staffEmailFinal
                    ? sendMail(staffEmailFinal, cancelApprovedStaffTemplate(booking, staffName, formattedDate))
                    : Promise.resolve(),
            ]);
            console.log('[reviewCancellation Emails] Sent');
        } catch (emailErr) {
            console.error('[reviewCancellation Email] Failed:', emailErr.message);
        }

        let message = 'Booking cancelled (no refund)';
        if (stripeRefunded) message = `Booking cancelled and £${(refundAmount / 100).toFixed(2)} refunded`;
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
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName email' } });
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        booking.status = status;
        if (internalNotes) booking.internalNotes = internalNotes;

        if (status === 'completed' && balanceReceived !== undefined) {
            const balancePence = Math.round(parseFloat(balanceReceived) * 100);
            if (balancePence > 0) {
                booking.paidAmount       = (booking.paidAmount || 0) + balancePence;
                booking.balanceRemaining = Math.max((booking.balanceRemaining || 0) - balancePence, 0);
                if (booking.balanceRemaining === 0) booking.paymentStatus = 'paid';
            }
        }

        await booking.save();

        if (status === 'cancelled' && booking.googleCalendarEventId) {
            const staff = await Staff.findById(booking.staffMember._id || booking.staffMember).catch(() => null);
            if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
        }

        // ── Emails for cancellation ───────────────────────────────────────────
        if (status === 'cancelled') {
            try {
                const staffFullDoc    = await Staff.findById(booking.staffMember?._id ?? booking.staffMember).populate('userId', 'firstName lastName email').catch(() => null);
                const staffName       = staffFullDoc?.userId ? `${staffFullDoc.userId.firstName} ${staffFullDoc.userId.lastName}` : 'Staff';
                const staffEmailFinal = staffFullDoc?.userId?.email || null;
                const formattedDate   = formatDate(booking.bookingDate);

                await Promise.all([
                    sendMail(booking.customerEmail, adminCancelCustomerTemplate(booking, formattedDate, '', 0, false)),
                    staffEmailFinal
                        ? sendMail(staffEmailFinal, adminCancelStaffTemplate(booking, staffName, formattedDate, '', false))
                        : Promise.resolve(),
                ]);
                console.log('[updateBookingStatus cancel Emails] Sent');
            } catch (emailErr) {
                console.error('[updateBookingStatus Email] Failed:', emailErr.message);
            }
        }

        await writeAuditLog({
            user: req.user,
            entity: 'booking',
            entityId: booking._id,
            action: `booking.status_updated`,
            description: `Booking ${booking.bookingNumber} status updated to "${status}"${internalNotes ? ` — Note: ${internalNotes}` : ''}`,
            after: { status, internalNotes },
            req,
        });

        res.status(200).json(booking);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/bookings/:id/admin-cancel ─────────────────────────────────────
export const adminCancelBooking = async (req, res) => {
    try {
        const { refundAmount = 0, reason = '', internalNotes = '', refundKey = '' } = req.body;

        if (refundAmount > 0) {
            const expectedKey = config.adminRefundKey;
            if (!expectedKey) return res.status(500).json({ message: 'ADMIN_REFUND_KEY is not configured on the server.' });
            if (refundKey !== expectedKey) return res.status(403).json({ message: 'Invalid refund key. Refund not authorised.' });
        }

        const booking = await Booking.findById(req.params.id)
            .populate('service', 'name price duration')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (['cancelled', 'completed', 'no-show'].includes(booking.status))
            return res.status(400).json({ message: `Cannot cancel a ${booking.status} booking` });

        let stripeRefundId = null, stripeErrMsg = null;
        if (refundAmount > 0 && booking.stripePaymentIntentId) {
            try {
                const stripe = (await import('stripe')).default(config.stripe.secretKey);
                const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
                stripeRefundId = refund.id;
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

        if (stripeRefunded) {
            await Payment.create({
                booking: booking._id, amount: refundAmount, type: 'refund', status: 'success',
                stripeTransactionId: stripeRefundId, processedAt: new Date(), processedBy: req.user.id,
            }).catch(err => console.error('[Payment refund record]', err.message));
        }

        if (booking.googleCalendarEventId) {
            const staffId = booking.staffMember?._id ?? booking.staffMember;
            const staff   = await Staff.findById(staffId).catch(() => null);
            if (staff) await deleteFromGoogleCalendar(staff, booking.googleCalendarEventId);
        }

        // ── Emails ────────────────────────────────────────────────────────────
        try {
            const staffFullDoc    = await Staff.findById(booking.staffMember?._id ?? booking.staffMember).populate('userId', 'firstName lastName email').catch(() => null);
            const staffName       = staffFullDoc?.userId ? `${staffFullDoc.userId.firstName} ${staffFullDoc.userId.lastName}` : 'Staff';
            const staffEmailFinal = staffFullDoc?.userId?.email || null;
            const formattedDate   = formatDate(booking.bookingDate);

            await Promise.all([
                sendMail(booking.customerEmail, adminCancelCustomerTemplate(booking, formattedDate, reason, refundAmount, stripeRefunded)),
                staffEmailFinal
                    ? sendMail(staffEmailFinal, adminCancelStaffTemplate(booking, staffName, formattedDate, reason, true))
                    : Promise.resolve(),
            ]);
            console.log('[adminCancelBooking Emails] Sent');
        } catch (emailErr) {
            console.error('[adminCancelBooking Email] Failed:', emailErr.message);
        }

        await writeAuditLog({
            user: req.user,
            entity: 'booking',
            entityId: booking._id,
            action: 'booking.admin_cancelled',
            description: `Admin cancelled booking ${booking.bookingNumber} for ${booking.customerName}${reason ? ` — Reason: ${reason}` : ''}${stripeRefunded ? ` — Refunded £${(refundAmount / 100).toFixed(2)}` : ''}`,
            before: { status: 'active' },
            after:  { status: 'cancelled', refundAmount, reason },
            meta:   { stripeRefunded, refundAmount },
            req,
        });

        let message = 'Booking cancelled';
        if (stripeRefunded) message = `Booking cancelled and £${(refundAmount / 100).toFixed(2)} refunded`;
        if (stripeErrMsg)   message = `Booking cancelled but refund failed: ${stripeErrMsg}`;

        res.status(200).json({ booking, message });
    } catch (err) {
        console.error('[adminCancelBooking]', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── GET /api/bookings/calendar ──────────────────────────────────────────────
export const getCalendarBookings = async (req, res) => {
    try {
        const { startDate, endDate, staffId } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: 'startDate and endDate required' });

        const query = {
            bookingDate: { $gte: colomboDayStart(startDate), $lte: colomboDayEnd(endDate) },
            status: { $nin: ['cancelled'] },
        };
        if (staffId) query.staffMember = staffId;

        const bookings = await Booking.find(query)
            .populate('service', 'name price duration color')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } })
            .sort({ bookingDate: 1, bookingTime: 1 });

        res.status(200).json({ bookings });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── GET /api/bookings/staff ──────────────────────────────────────────────────
export const getStaffBookings = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

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

// ─── POST /api/bookings/:id/cancel-request (customer) ────────────────────────
export const requestReschedule = async (req, res) => {
    try {
        const { newDate, newTime, newStaffId, reason } = req.body;
        if (!newDate || !newTime)
            return res.status(400).json({ message: 'newDate and newTime are required' });

        const booking = await Booking.findById(req.params.id).populate('service');
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const user = await User.findById(req.user.id);
        if (!user || user.email.toLowerCase() !== booking.customerEmail.toLowerCase())
            return res.status(403).json({ message: 'Not authorised' });

        if (['cancelled', 'completed', 'no-show'].includes(booking.status))
            return res.status(400).json({ message: `Cannot reschedule a ${booking.status} booking` });

        if (booking.rescheduleRequestStatus === 'pending')
            return res.status(400).json({ message: 'A reschedule request is already pending' });

        const bookingDateStr  = new Date(booking.bookingDate).toLocaleDateString('en-CA', { timeZone: TZ });
        const bookingDateTime = new Date(`${bookingDateStr}T${booking.bookingTime}:00`);
        const hoursUntil      = (bookingDateTime - new Date()) / (1000 * 60 * 60);
        if (hoursUntil <= 48)
            return res.status(400).json({ message: 'Reschedule requests can only be made more than 48 hours before your appointment' });

        const newDateTime    = new Date(`${newDate}T${newTime}:00`);
        const newHoursUntil  = (newDateTime - new Date()) / (1000 * 60 * 60);
        if (newHoursUntil <= 48)
            return res.status(400).json({ message: 'The new appointment time must also be more than 48 hours from now' });

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
        if (newDate <= todayStr)
            return res.status(400).json({ message: 'New booking date must be in the future' });

        booking.rescheduleRequestedAt   = new Date();
        booking.rescheduleRequestedBy   = req.user.id;
        booking.rescheduleReason        = reason || '';
        booking.rescheduleRequestStatus = 'pending';
        booking.rescheduleDate          = colomboDayStart(newDate);
        booking.rescheduleTime          = newTime;
        booking.rescheduleStaffMember   = newStaffId || booking.staffMember;
        await booking.save();

        res.status(200).json({ message: 'Reschedule request submitted successfully', booking });
    } catch (err) {
        console.error('[requestReschedule]', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/bookings/:id/reschedule-review (admin) ────────────────────────
export const reviewReschedule = async (req, res) => {
    try {
        const {
            action, newDate, newTime, newStaffId,
            refundAmount = 0, refundKey = '', adminNote = '',
        } = req.body;

        if (!['approve', 'reject', 'cancel'].includes(action))
            return res.status(400).json({ message: 'action must be approve, reject, or cancel' });

        const booking = await Booking.findById(req.params.id)
            .populate('service')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName' } });

        if (!booking) return res.status(404).json({ message: 'Booking not found' });
        if (booking.rescheduleRequestStatus !== 'pending')
            return res.status(400).json({ message: 'No pending reschedule request on this booking' });

        // ── REJECT ────────────────────────────────────────────────────────────
        if (action === 'reject') {
            booking.rescheduleRequestStatus = 'rejected';
            if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Reschedule rejected] ${adminNote}`;
            await booking.save();
            return res.status(200).json({ message: 'Reschedule request rejected', booking });
        }

        // ── CANCEL ────────────────────────────────────────────────────────────
        if (action === 'cancel') {
            if (refundAmount > 0) {
                const expectedKey = config.adminRefundKey;
                if (!expectedKey) return res.status(500).json({ message: 'ADMIN_REFUND_KEY is not configured.' });
                if (refundKey !== expectedKey) return res.status(403).json({ message: 'Invalid refund key.' });
            }
            let stripeRefundId = null, stripeErrMsg = null;
            if (refundAmount > 0 && booking.stripePaymentIntentId) {
                try {
                    const { default: Stripe } = await import('stripe');
                    const stripe = new Stripe(config.stripe.secretKey);
                    const refund = await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId, amount: refundAmount });
                    stripeRefundId = refund.id;
                } catch (e) { stripeErrMsg = e.message; }
            }
            booking.status                  = 'cancelled';
            booking.rescheduleRequestStatus = 'rejected';
            booking.cancelledAt             = new Date();
            booking.cancelledBy             = req.user.id;
            booking.cancellationReason      = booking.rescheduleReason || 'Cancelled during reschedule review';
            if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Reschedule→Cancel] ${adminNote}`;
            if (stripeRefundId) {
                booking.refundAmount  = refundAmount;
                booking.refundedAt    = new Date();
                booking.paymentStatus = refundAmount >= booking.paidAmount ? 'refunded' : 'partially_refunded';
                booking.paidAmount    = booking.paidAmount - refundAmount;
            }
            await booking.save();
            if (booking.googleCalendarEventId) {
                const oldStaff = await Staff.findById(booking.staffMember?._id ?? booking.staffMember).catch(() => null);
                if (oldStaff) await deleteFromGoogleCalendar(oldStaff, booking.googleCalendarEventId);
            }
            return res.status(200).json({
                message: stripeRefundId
                    ? `Booking cancelled and £${(refundAmount / 100).toFixed(2)} refunded`
                    : stripeErrMsg ? `Booking cancelled but refund failed: ${stripeErrMsg}` : 'Booking cancelled',
                booking,
            });
        }

        // ── APPROVE ───────────────────────────────────────────────────────────
        const finalDate    = newDate    || new Date(booking.rescheduleDate).toLocaleDateString('en-CA', { timeZone: TZ });
        const finalTime    = newTime    || booking.rescheduleTime;
        const finalStaffId = newStaffId || (booking.rescheduleStaffMember?.toString() || booking.staffMember?._id?.toString() || booking.staffMember?.toString());

        if (!finalDate || !finalTime)
            return res.status(400).json({ message: 'newDate and newTime are required for approval' });

        const service   = booking.service;
        const startMins = toMins(finalTime);
        const endMins   = startMins + service.duration;

        const dayStart_new = colomboDayStart(finalDate);
        const dayEnd_new   = colomboDayEnd(finalDate);
        const dayName_new  = tzDayName(finalDate);

        const newStaffDoc = await Staff.findById(finalStaffId);
        if (!newStaffDoc || newStaffDoc.isOnLeave)
            return res.status(409).json({ message: 'Selected staff is not available (on leave or not found)' });

        const [leavesForSlot, bookingsForSlot, googleBkgs, tempLocks] = await Promise.all([
            Leave.find({ staffId: finalStaffId, status: 'approved', startDate: { $lte: dayEnd_new }, endDate: { $gte: dayStart_new } }),
            Booking.find({ staffMember: finalStaffId, bookingDate: { $gte: dayStart_new, $lte: dayEnd_new }, status: { $nin: ['cancelled'] }, _id: { $ne: booking._id } }),
            Googlebooking.find({ staffId: finalStaffId, date: { $gte: dayStart_new, $lte: dayEnd_new } }),
            TempSlotLock.find({ staffId: finalStaffId, bookingDate: finalDate, expiresAt: { $gt: new Date() } }),
        ]);

        const slotFree = isSlotFreeSync(startMins, endMins, {
            daySchedule:      newStaffDoc.workingHours?.[dayName_new],
            approvedLeaves:   leavesForSlot,
            existingBookings: bookingsForSlot,
            googleBookings:   googleBkgs,
            tempLocks,
            bookingDate:      finalDate,
        });

        if (!slotFree)
            return res.status(409).json({ message: `${finalTime} on ${finalDate} is not available for this staff member` });

        const oldStaffId       = booking.staffMember?._id?.toString() ?? booking.staffMember?.toString();
        const staffChanged     = oldStaffId !== finalStaffId.toString();
        const oldGoogleEventId = booking.googleCalendarEventId || null;

        booking.previousBookingDate   = booking.bookingDate;
        booking.previousBookingTime   = booking.bookingTime;
        booking.previousStaffMember   = booking.staffMember?._id ?? booking.staffMember;
        booking.previousGoogleEventId = oldGoogleEventId;

        if (oldGoogleEventId) {
            const oldStaffDoc = await Staff.findById(oldStaffId).catch(() => null);
            if (oldStaffDoc) await deleteFromGoogleCalendar(oldStaffDoc, oldGoogleEventId);
        }

        booking.bookingDate               = colomboDayStart(finalDate);
        booking.bookingTime               = finalTime;
        booking.staffMember               = finalStaffId;
        booking.googleCalendarEventId     = null;
        booking.rescheduleRequestStatus   = 'approved';
        booking.consultationFormCompleted = false;
        if (adminNote) booking.internalNotes = (booking.internalNotes ? booking.internalNotes + '\n' : '') + `[Reschedule approved → ${finalDate} ${finalTime}] ${adminNote}`;
        await booking.save();

        const newStaffFull = await Staff.findById(finalStaffId).populate('userId', 'firstName lastName email').catch(() => null);
        if (newStaffFull) {
            const gcalEventId = await addToGoogleCalendar(newStaffFull, booking, service);
            if (gcalEventId) { booking.googleCalendarEventId = gcalEventId; await booking.save(); }
        }

        // ── Emails ────────────────────────────────────────────────────────────
        try {
            const allAdmins     = await User.find({ role: 'admin', isActive: true }).select('email');
            const newStaffUser  = newStaffFull?.userId;
            const newStaffEmail = newStaffUser?.email || null;
            const newStaffName  = newStaffUser ? `${newStaffUser.firstName} ${newStaffUser.lastName}` : 'Staff';
            const formattedDate = formatDate(booking.bookingDate);
            const adminEmails   = allAdmins.map(a => a.email).filter(Boolean);

            const emailJobs = [
                newStaffEmail
                    ? sendMail(newStaffEmail, rescheduleNewStaffTemplate(booking, service, newStaffName, formattedDate, finalTime, adminNote))
                    : Promise.resolve(),
                sendMail(booking.customerEmail, rescheduleCustomerTemplate(booking, service, newStaffName, formattedDate, finalTime)),
                adminEmails.length
                    ? sendMail(adminEmails, rescheduleAdminTemplate(booking, newStaffName, formattedDate, finalTime, staffChanged, adminNote))
                    : Promise.resolve(),
            ];

            if (staffChanged) {
                const oldStaffDoc2  = await Staff.findById(oldStaffId).populate('userId', 'firstName lastName email').catch(() => null);
                const oldStaffEmail = oldStaffDoc2?.userId?.email;
                const oldStaffName  = oldStaffDoc2?.userId ? `${oldStaffDoc2.userId.firstName} ${oldStaffDoc2.userId.lastName}` : 'Staff';
                const oldDateStr    = formatDate(booking.previousBookingDate);
                if (oldStaffEmail)
                    emailJobs.push(sendMail(oldStaffEmail, rescheduleOldStaffTemplate(booking, service, oldStaffName, newStaffName, oldDateStr)));
            }

            await Promise.all(emailJobs);
            console.log('[Reschedule Emails] Sent: new staff, customer, admin', staffChanged ? ', old staff' : '');
        } catch (emailErr) {
            console.error('[Reschedule Email] Failed:', emailErr.message);
        }

        const populated = await Booking.findById(booking._id)
            .populate('service', 'name price duration')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } });

        res.status(200).json({ message: 'Reschedule approved — new appointment confirmed', booking: populated });
    } catch (err) {
        console.error('[reviewReschedule]', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/bookings/:id/consultation-form ─────────────────────────────────
export const submitConsultationForm = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('service', 'name')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName email' } });

        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        if (booking.customerEmail.toLowerCase() !== (req.user?.email || '').toLowerCase())
            return res.status(403).json({ message: 'Not authorised' });

        if (booking.consultationFormCompleted)
            return res.status(400).json({ message: 'Consultation form already submitted' });

        booking.consultationFormCompleted = true;
        await booking.save();

        // ── Emails ────────────────────────────────────────────────────────────
        try {
            const admins     = await User.find({ role: 'admin', isActive: true }).select('email');
            const staffEmail = booking.staffMember?.userId?.email;
            const recipients = [...admins.map(a => a.email), ...(staffEmail ? [staffEmail] : [])].filter(Boolean);

            await sendMail(recipients, consultationFormTemplate(booking, req.body));
            console.log('[Consultation Form Email] Sent to:', recipients.join(', '));
        } catch (emailErr) {
            console.error('[Consultation Form Email] Failed:', emailErr.message);
        }

        res.status(200).json({ message: 'Consultation form submitted successfully', consultationFormCompleted: true });
    } catch (err) {
        console.error('[submitConsultationForm]', err);
        res.status(500).json({ message: err.message });
    }
};