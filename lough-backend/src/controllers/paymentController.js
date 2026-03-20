// controllers/paymentController.js
import Stripe      from 'stripe';
import Booking      from '../models/bookingModel.js';
import Payment      from '../models/paymentModel.js';
import TempSlotLock from '../models/tempSlotLock.js';
import Service      from '../models/service.js';
import Staff        from '../models/staff.js';
import User         from '../models/user.js';
import config       from '../config/index.js';
import { addToGoogleCalendar, fromMins, toMins, colomboDayStart } from './bookingController.js';
import { TZ }       from '../utils/timezone.js';
import { sendMail } from '../utils/mailer.js';                           // ✅ Singleton
import {
    customerBookingTemplate,
    staffBookingTemplate,
    adminBookingTemplate,
} from '../utils/bookingEmailTemplates.js';                              // ✅ Templates

const stripe = new Stripe(config.stripe.secretKey);

// ─── 1. CUSTOMER EMAIL ────────────────────────────────────────────────────────
const sendCustomerEmail = async (booking, service) => {
    try {
        await sendMail(booking.customerEmail, customerBookingTemplate(booking, service));
        console.log('[Email → Customer]', booking.customerEmail);
    } catch (err) {
        console.error('[Email → Customer] Failed:', err.message);
    }
};

// ─── 2. STAFF EMAIL ───────────────────────────────────────────────────────────
const sendStaffEmail = async (booking, service, staffUser) => {
    try {
        if (!staffUser?.email) {
            console.warn('[Email → Staff] No email on staffUser, skipping.');
            return;
        }
        await sendMail(staffUser.email, staffBookingTemplate(booking, service, staffUser));
        console.log('[Email → Staff]', staffUser.email);
    } catch (err) {
        console.error('[Email → Staff] Failed:', err.message);
    }
};

// ─── 3. ADMIN EMAIL ───────────────────────────────────────────────────────────
const sendAdminEmail = async (booking, service, staffUser) => {
    try {
        const admins = await User.find({ role: 'admin', isActive: true }).select('email firstName');
        if (!admins.length) {
            console.warn('[Email → Admin] No active admin users in DB, skipping.');
            return;
        }
        const adminEmails = admins.map(a => a.email);
        await sendMail(adminEmails, adminBookingTemplate(booking, service, staffUser));
        console.log('[Email → Admin]', adminEmails.join(', '));
    } catch (err) {
        console.error('[Email → Admin] Failed:', err.message);
    }
};

// ─── Send all 3 emails in parallel ───────────────────────────────────────────
const sendAllEmails = async (booking, service, staff) => {
    const staffUser = staff?.userId ?? null;
    await Promise.all([
        sendCustomerEmail(booking, service),
        sendStaffEmail(booking, service, staffUser),
        sendAdminEmail(booking, service, staffUser),
    ]);
};

// ─── Shared booking creation logic ───────────────────────────────────────────
const createBookingFromSession = async (session) => {
    const m = session.metadata;

    const existing = await Booking.findOne({ stripePaymentIntentId: session.payment_intent });
    if (existing) return existing;

    const service = await Service.findById(m.serviceId);
    if (!service) throw new Error('Service not found: ' + m.serviceId);

    const totalAmount   = parseInt(m.totalAmount,   10);
    const depositAmount = parseInt(m.depositAmount, 10);
    const paymentType   = m.paymentType;
    const paidAmount    = paymentType === 'full' ? totalAmount : depositAmount;

    const bookingNumber = 'BK-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000);

    const booking = await Booking.create({
        bookingNumber,
        customerName:    m.customerName,
        customerEmail:   m.customerEmail,
        customerPhone:   m.customerPhone,
        customerAddress: m.customerAddress  || undefined,
        customerGender:  m.customerGender   || undefined,
        customerNotes:   m.customerNotes    || undefined,
        service:         m.serviceId,
        staffMember:     m.staffId,
        bookingDate:     colomboDayStart(m.bookingDate),
        bookingTime:     m.bookingTime,
        duration:        service.duration,
        status:          'pending',
        totalAmount,
        depositAmount,
        paidAmount,
        balanceRemaining: totalAmount - paidAmount,
        paymentType,
        paymentStatus:   'paid',
        stripePaymentIntentId: session.payment_intent,
        consentFormCompleted: true,
        consentData: {
            termsAccepted:         m.consentTerms     === '1',
            privacyPolicyAccepted: m.consentPrivacy   === '1',
            marketingEmails:       m.consentMarketing === '1',
        },
        bookingSource: 'website',
        createdBy:     m.bookedByUserId || undefined,
    });

    // Payment record
    await Payment.create({
        booking:             booking._id,
        amount:              paidAmount,
        type:                'payment',
        status:              'success',
        stripeTransactionId: session.payment_intent,
        processedAt:         new Date(),
    }).catch(() => {});

    // Release temp slot lock
    await TempSlotLock.deleteOne({ sessionId: session.id }).catch(() => {});

    const staff = await Staff.findById(m.staffId).populate('userId', 'firstName lastName email');

    if (staff) {
        const gcalEventId = await addToGoogleCalendar(staff, booking, service).catch(() => null);
        if (gcalEventId) {
            booking.googleCalendarEventId = gcalEventId;
            await booking.save();
        }
    }

    await sendAllEmails(booking, service, staff);

    return booking;
};

// ─── POST /api/payments/create-checkout ──────────────────────────────────────
export const createCheckoutSession = async (req, res) => {
    try {
        const {
            serviceId, staffId, bookingDate, bookingTime,
            customerName, customerEmail, customerPhone,
            customerAddress, customerGender, customerNotes,
            staffGenderPreference,
            paymentType = 'deposit',
            consentData,
        } = req.body;

        // Validate booking date — must be tomorrow or later
        if (bookingDate) {
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
            if (bookingDate <= todayStr) {
                return res.status(400).json({
                    message: 'Booking date must be at least 1 day in the future. Same-day bookings are not accepted.',
                });
            }
        }

        // Validate UK phone number
        if (customerPhone) {
            const stripped = customerPhone.replace(/[\s\-().]/g, '');
            const isUKPhone =
                /^07\d{9}$/.test(stripped)         ||
                /^\+447\d{9}$/.test(stripped)      ||
                /^0[1-3]\d{8,9}$/.test(stripped)   ||
                /^\+44[1-3]\d{8,9}$/.test(stripped);
            if (!isUKPhone) {
                return res.status(400).json({
                    message: 'Please provide a valid UK phone number (e.g. 07700 900000 or +447700900000).',
                });
            }
        }

        const service = await Service.findById(serviceId);
        if (!service || !service.isActive)
            return res.status(404).json({ message: 'Service not found' });

        const totalAmount   = Math.round(service.price * 100);
        const depositAmount = Math.round(totalAmount * (service.depositPercentage || 0.30));
        const chargeAmount  = paymentType === 'full' ? totalAmount : depositAmount;

        const existingLock = await TempSlotLock.findOne({
            staffId, bookingDate, bookingTime,
            expiresAt: { $gt: new Date() },
        });
        if (existingLock)
            return res.status(409).json({
                message: 'This slot is currently being held by another customer. Please try again shortly.',
            });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode:           'payment',
            customer_email: customerEmail,
            line_items: [{
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: service.name,
                        description: paymentType === 'deposit'
                            ? 'Deposit (' + Math.round((service.depositPercentage || 0.30) * 100) + '%) — balance due at salon'
                            : 'Full payment',
                    },
                    unit_amount: chargeAmount,
                },
                quantity: 1,
            }],
            metadata: {
                serviceId:             serviceId.toString(),
                staffId:               staffId.toString(),
                bookingDate,
                bookingTime,
                customerName,
                customerEmail,
                customerPhone,
                customerAddress:       customerAddress       || '',
                customerGender:        customerGender        || '',
                customerNotes:         customerNotes         || '',
                staffGenderPreference: staffGenderPreference || 'any',
                paymentType,
                totalAmount:           totalAmount.toString(),
                depositAmount:         depositAmount.toString(),
                bookedByUserId:        req.user?.id?.toString() || '',
                consentTerms:          consentData?.termsAccepted         ? '1' : '0',
                consentPrivacy:        consentData?.privacyPolicyAccepted ? '1' : '0',
                consentMarketing:      consentData?.marketingEmails       ? '1' : '0',
            },
            success_url: config.userlUrl + '/booking/success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url:  config.userlUrl + '/booking/cancelled',
            expires_at:  Math.floor(Date.now() / 1000) + 1800,
        });

        await TempSlotLock.create({
            staffId,
            serviceId,
            bookingDate,
            bookingTime,
            duration:  service.duration,
            sessionId: session.id,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (err) {
        console.error('[createCheckoutSession]', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/payments/webhook ───────────────────────────────────────────────
export const stripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
        console.error('[Webhook] Signature failed:', err.message);
        return res.status(400).send('Webhook Error: ' + err.message);
    }

    if (event.type === 'checkout.session.completed') {
        try {
            const booking = await createBookingFromSession(event.data.object);
            console.log('[Webhook] Booking created:', booking.bookingNumber);
        } catch (err) {
            console.error('[Webhook] Error:', err.message);
        }
    }

    if (event.type === 'checkout.session.expired') {
        await TempSlotLock.deleteOne({ sessionId: event.data.object.id }).catch(() => {});
        console.log('[Webhook] Lock released for expired session:', event.data.object.id);
    }

    res.json({ received: true });
};

// ─── GET /api/payments/session/:sessionId ────────────────────────────────────
export const getSessionBooking = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid')
            return res.status(402).json({ message: 'Payment not completed' });

        const booking = await createBookingFromSession(session);

        const populated = await Booking.findById(booking._id)
            .populate('service', 'name price duration')
            .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } });

        res.status(200).json(populated);
    } catch (err) {
        if (err.code === 11000) {
            const session = await stripe.checkout.sessions.retrieve(req.params.sessionId).catch(() => null);
            if (session?.payment_intent) {
                const b = await Booking.findOne({ stripePaymentIntentId: session.payment_intent })
                    .populate('service', 'name price duration')
                    .populate({ path: 'staffMember', populate: { path: 'userId', select: 'firstName lastName profileImage' } });
                if (b) return res.status(200).json(b);
            }
        }
        console.error('[getSessionBooking]', err);
        res.status(500).json({ message: err.message });
    }
};