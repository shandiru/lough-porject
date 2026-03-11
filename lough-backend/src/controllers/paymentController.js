import Stripe      from 'stripe';
import nodemailer   from 'nodemailer';
import Booking      from '../models/bookingModel.js';
import Payment      from '../models/paymentModel.js';
import TempSlotLock from '../models/tempSlotLock.js';
import Service      from '../models/service.js';
import Staff        from '../models/staff.js';
import User         from '../models/user.js';
import config       from '../config/index.js';
import { addToGoogleCalendar, fromMins, toMins } from './bookingController.js';

const stripe = new Stripe(config.stripe.secretKey);

// ─── Mailer ───────────────────────────────────────────────────────────────────
const mailer = () => nodemailer.createTransport({
  service: 'gmail',
  auth: { user: config.email.user, pass: config.email.pass },
});

// ─── HTML building blocks ─────────────────────────────────────────────────────
const row = (label, value, bg = '#ffffff') =>
  value
    ? `<tr style="background:${bg}">
         <td style="padding:10px 14px;font-weight:600;color:#555;width:38%;font-size:13px">${label}</td>
         <td style="padding:10px 14px;color:#222;font-size:13px">${value}</td>
       </tr>`
    : '';

const tableHtml = (rows) =>
  `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden">${rows}</table>`;

const sectionTitle = (t) =>
  `<p style="font-weight:700;color:#22B8C8;font-size:14px;margin:20px 0 4px;text-transform:uppercase;letter-spacing:.5px">${t}</p>`;

const wrap = (headerHtml, bodyHtml) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#333">
    <div style="background:linear-gradient(135deg,#22B8C8 0%,#1a9aad 100%);padding:28px 32px;text-align:center;border-radius:12px 12px 0 0">
      ${headerHtml}
    </div>
    <div style="background:#fafafa;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none">
      ${bodyHtml}
    </div>
    <p style="text-align:center;font-size:11px;color:#bbb;margin-top:20px">Lough Skin · Automated notification</p>
  </div>`;

// ─── 1. CUSTOMER EMAIL ────────────────────────────────────────────────────────
// Appointment info + payment they made. No staff contact, no internal data.
const sendCustomerEmail = async (booking, service) => {
  try {
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const paid    = (booking.paidAmount       / 100).toFixed(2);
    const balance = (booking.balanceRemaining / 100).toFixed(2);
    const total   = (booking.totalAmount      / 100).toFixed(2);
    const date    = new Date(booking.bookingDate).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    await mailer().sendMail({
      from:    `"Lough Skin" <${config.email.user}>`,
      to:      booking.customerEmail,
      subject: `Booking Confirmed — ${service.name} on ${date}`,
      html: wrap(
        `<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Booking Confirmed! 🎉</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="margin-top:0">Hi <strong>${booking.customerName}</strong>,</p>
         <p style="color:#555;font-size:14px">Your appointment is confirmed and payment received. We look forward to seeing you!</p>

         ${sectionTitle('Appointment')}
         ${tableHtml(`
           ${row('Booking #',  '<span style="font-family:monospace;font-weight:700">' + booking.bookingNumber + '</span>', '#f0fafa')}
           ${row('Service',    service.name)}
           ${row('Date',       date, '#f0fafa')}
           ${row('Time',       booking.bookingTime + ' – ' + endTime)}
           ${row('Duration',   service.duration + ' minutes', '#f0fafa')}
         `)}

         ${sectionTitle('Payment')}
         ${tableHtml(`
           ${row('Paid today', '<span style="color:#22B8C8;font-weight:700;font-size:15px">£' + paid + '</span>', '#f0fafa')}
           ${parseFloat(balance) > 0
             ? row('Balance at salon', '<span style="color:#f59e0b;font-weight:700">£' + balance + '</span>', '#fff8e1')
             : row('Balance at salon', '<span style="color:#065f46;font-weight:700">£0.00 — fully paid</span>', '#d1fae5')}
           ${row('Total', '<strong>£' + total + '</strong>')}
         `)}

         <p style="font-size:13px;color:#888;margin-top:20px">Need to cancel or reschedule? Please contact us as soon as possible.</p>
         <p style="font-size:13px;color:#555;margin-bottom:0">See you soon! 💆‍♀️<br><strong>The Lough Skin Team</strong></p>`
      ),
    });
    console.log('[Email → Customer]', booking.customerEmail);
  } catch (err) {
    console.error('[Email → Customer] Failed:', err.message);
  }
};

// ─── 2. STAFF EMAIL ───────────────────────────────────────────────────────────
// Appointment + client contact details ONLY. Zero payment info.
const sendStaffEmail = async (booking, service, staffUser) => {
  try {
    if (!staffUser?.email) {
      console.warn('[Email → Staff] No email on staffUser, skipping.');
      return;
    }
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const date    = new Date(booking.bookingDate).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    await mailer().sendMail({
      from:    `"Lough Skin" <${config.email.user}>`,
      to:      staffUser.email,
      subject: `New Appointment — ${service.name} on ${date}`,
      html: wrap(
        `<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">New Appointment 📅</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">You have a new client booked</p>`,
        `<p style="margin-top:0">Hi <strong>${staffUser.firstName}</strong>,</p>
         <p style="color:#555;font-size:14px">A new booking has been confirmed for you. Here are the details:</p>

         ${sectionTitle('Appointment')}
         ${tableHtml(`
           ${row('Booking #',  '<span style="font-family:monospace;font-weight:700">' + booking.bookingNumber + '</span>', '#f0fafa')}
           ${row('Service',    service.name)}
           ${row('Date',       date, '#f0fafa')}
           ${row('Time',       booking.bookingTime + ' – ' + endTime)}
           ${row('Duration',   service.duration + ' minutes', '#f0fafa')}
         `)}

         ${sectionTitle('Client Details')}
         ${tableHtml(`
           ${row('Name',    booking.customerName, '#f0fafa')}
           ${row('Phone',   '<a href="tel:' + booking.customerPhone + '" style="color:#22B8C8;text-decoration:none">' + booking.customerPhone + '</a>')}
           ${row('Email',   '<a href="mailto:' + booking.customerEmail + '" style="color:#22B8C8;text-decoration:none">' + booking.customerEmail + '</a>', '#f0fafa')}
           ${row('Address', booking.customerAddress || '')}
           ${booking.customerNotes
             ? row('Client notes', '<em style="color:#c0392b">' + booking.customerNotes + '</em>', '#fff8e1')
             : ''}
         `)}

         <p style="font-size:13px;color:#888;margin-top:20px">Log in to the dashboard to manage this appointment.</p>
         <p style="font-size:13px;color:#555;margin-bottom:0"><strong>The Lough Skin Team</strong></p>`
      ),
    });
    console.log('[Email → Staff]', staffUser.email);
  } catch (err) {
    console.error('[Email → Staff] Failed:', err.message);
  }
};

// ─── 3. ADMIN EMAIL ───────────────────────────────────────────────────────────
// Full details: appointment + customer + full payment breakdown.
// Queries ALL users with role=admin from DB and sends to all of them.
const sendAdminEmail = async (booking, service, staffUser) => {
  try {
    const admins = await User.find({ role: 'admin', isActive: true }).select('email firstName');
    if (!admins.length) {
      console.warn('[Email → Admin] No active admin users in DB, skipping.');
      return;
    }
    const adminEmails = admins.map(a => a.email); // array — nodemailer accepts array

    const endTime  = fromMins(toMins(booking.bookingTime) + service.duration);
    const paid     = (booking.paidAmount        / 100).toFixed(2);
    const balance  = (booking.balanceRemaining  / 100).toFixed(2);
    const deposit  = (booking.depositAmount     / 100).toFixed(2);
    const total    = (booking.totalAmount       / 100).toFixed(2);
    const date     = new Date(booking.bookingDate).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const staffName = staffUser ? staffUser.firstName + ' ' + staffUser.lastName : 'Unknown';

    const paymentBadge = booking.paymentType === 'full'
      ? '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">FULL PAYMENT</span>'
      : '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">DEPOSIT</span>';

    await mailer().sendMail({
      from:    `"Lough Skin System" <${config.email.user}>`,
      to:      adminEmails,
      subject: '[Admin] New Booking ' + booking.bookingNumber + ' — ' + booking.customerName + ' — ' + service.name,
      html: wrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">[Admin] New Booking</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber} · ${date}</p>`,
        `<p style="margin-top:0;font-size:12px;color:#aaa">Automated admin notification — do not share with customers or staff.</p>

         ${sectionTitle('Appointment')}
         ${tableHtml(`
           ${row('Booking #',  '<span style="font-family:monospace;font-weight:700">' + booking.bookingNumber + '</span>', '#f0fafa')}
           ${row('Service',    service.name)}
           ${row('Date',       date, '#f0fafa')}
           ${row('Time',       booking.bookingTime + ' – ' + endTime)}
           ${row('Duration',   service.duration + ' minutes', '#f0fafa')}
           ${row('Staff',      staffName)}
           ${row('Source',     booking.bookingSource || 'website', '#f0fafa')}
         `)}

         ${sectionTitle('Customer')}
         ${tableHtml(`
           ${row('Name',    booking.customerName, '#f0fafa')}
           ${row('Email',   '<a href="mailto:' + booking.customerEmail + '" style="color:#22B8C8;text-decoration:none">' + booking.customerEmail + '</a>')}
           ${row('Phone',   '<a href="tel:' + booking.customerPhone + '" style="color:#22B8C8;text-decoration:none">' + booking.customerPhone + '</a>', '#f0fafa')}
           ${row('Address', booking.customerAddress || '')}
           ${row('Gender',  booking.customerGender  || '', '#f0fafa')}
           ${booking.customerNotes
             ? row('Notes', '<em style="color:#c0392b">' + booking.customerNotes + '</em>', '#fff8e1')
             : ''}
         `)}

         ${sectionTitle('Payment')}
         ${tableHtml(`
           ${row('Type',          paymentBadge, '#f0fafa')}
           ${row('Total',         '<strong style="font-size:15px">£' + total + '</strong>')}
           ${row('Deposit amount','£' + deposit, '#f0fafa')}
           ${row('Paid now',      '<span style="color:#22B8C8;font-weight:700;font-size:15px">£' + paid + '</span>')}
           ${parseFloat(balance) > 0
             ? row('Balance due at salon', '<span style="color:#f59e0b;font-weight:700">£' + balance + '</span>', '#fff8e1')
             : row('Balance due at salon', '<span style="color:#065f46;font-weight:700">£0.00 — fully paid</span>', '#d1fae5')}
           ${row('Payment status', booking.paymentStatus, '#f0fafa')}
           ${booking.stripePaymentIntentId
             ? row('Stripe PI', '<span style="font-family:monospace;font-size:11px;color:#888">' + booking.stripePaymentIntentId + '</span>')
             : ''}
         `)}
        `
      ),
    });
    console.log('[Email → Admin]', adminEmails.join(', '));
  } catch (err) {
    console.error('[Email → Admin] Failed:', err.message);
  }
};

// ─── Send all 3 emails in parallel ───────────────────────────────────────────
// staff must already be .populate('userId', 'firstName lastName email') by caller
const sendAllEmails = async (booking, service, staff) => {
  const staffUser = staff?.userId ?? null;
  await Promise.all([
    sendCustomerEmail(booking, service),
    sendStaffEmail(booking, service, staffUser),
    sendAdminEmail(booking, service, staffUser),
  ]);
};

// ─── Shared booking creation logic (used by webhook + getSessionBooking) ──────
const createBookingFromSession = async (session) => {
  const m = session.metadata;

  // Idempotency — don't create twice
  const existing = await Booking.findOne({ stripePaymentIntentId: session.payment_intent });
  if (existing) return existing;

  const service = await Service.findById(m.serviceId);
  if (!service) throw new Error('Service not found: ' + m.serviceId);

  const totalAmount   = parseInt(m.totalAmount,   10);
  const depositAmount = parseInt(m.depositAmount, 10);
  const paymentType   = m.paymentType;
  const paidAmount    = paymentType === 'full' ? totalAmount : depositAmount;

  const bookingNumber = 'BK-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000+Math.random()*9000);

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
    bookingDate:     new Date(m.bookingDate),
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

  // Fetch staff with userId (needs email for staff email, name for admin email)
  const staff = await Staff.findById(m.staffId).populate('userId', 'firstName lastName email');

  // Google Calendar (non-fatal)
  if (staff) await addToGoogleCalendar(staff, booking, service).catch(() => {});

  // Send emails: customer + staff + all admins — in parallel
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
      staffId, serviceId, bookingDate, bookingTime,
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