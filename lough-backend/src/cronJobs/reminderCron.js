import cron    from 'node-cron';
import Booking  from '../models/bookingModel.js';
import Service  from '../models/service.js';
import Staff    from '../models/staff.js';
import User     from '../models/user.js';
import { sendMail } from '../utils/mailer.js';          
import config   from '../config/index.js';
import { TZ }   from '../utils/timezone.js';
import { fromMins, toMins } from '../controllers/bookingController.js';
import moment   from 'moment-timezone';


// ─── Email HTML Helpers ───────────────────────────────────────────────────────

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
    <p style="text-align:center;font-size:11px;color:#bbb;margin-top:20px">Lough Skin · Automated reminder</p>
  </div>`;

const formatDateTZ = (dateVal) =>
  new Date(dateVal).toLocaleDateString('en-GB', {
    timeZone: TZ,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });


// ─── Customer Reminder Email ──────────────────────────────────────────────────

const sendCustomerReminder = async (booking, service) => {
  try {
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const date    = formatDateTZ(booking.bookingDate);
    const balance = (booking.balanceRemaining / 100).toFixed(2);

    
    await sendMail(booking.customerEmail, {
      subject: `Reminder: Your appointment tomorrow — ${service.name}`,
      html: wrap(
        `<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Appointment Reminder ⏰</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="margin-top:0">Hi <strong>${booking.customerName}</strong>,</p>
         <p style="color:#555;font-size:14px">This is a friendly reminder that you have an appointment with us <strong>tomorrow</strong>. We look forward to seeing you!</p>

         ${sectionTitle('Your Appointment')}
         ${tableHtml(`
           ${row('Booking #',  '<span style="font-family:monospace;font-weight:700">' + booking.bookingNumber + '</span>', '#f0fafa')}
           ${row('Service',    service.name)}
           ${row('Date',       date, '#f0fafa')}
           ${row('Time',       booking.bookingTime + ' – ' + endTime)}
           ${row('Duration',   service.duration + ' minutes', '#f0fafa')}
         `)}

         ${parseFloat(balance) > 0 ? `
         ${sectionTitle('Balance Due')}
         ${tableHtml(row('Balance at salon', '<span style="color:#f59e0b;font-weight:700;font-size:15px">£' + balance + '</span>', '#fff8e1'))}
         <p style="font-size:12px;color:#888">Please bring the remaining balance to pay at the salon.</p>
         ` : ''}

         <p style="font-size:13px;color:#888;margin-top:20px">Need to cancel or reschedule? Please contact us as soon as possible.</p>
         <p style="font-size:13px;color:#555;margin-bottom:0">See you soon! 💆‍♀️<br><strong>The Lough Skin Team</strong></p>`
      ),
    });
    console.log('[Reminder → Customer]', booking.customerEmail, booking.bookingNumber);
  } catch (err) {
    console.error('[Reminder → Customer] Failed:', err.message);
  }
};




const sendStaffReminder = async (booking, service, staffUser) => {
  try {
    if (!staffUser?.email) {
      console.warn('[Reminder → Staff] No email, skipping. bookingId:', booking._id);
      return;
    }
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const date    = formatDateTZ(booking.bookingDate);

  
    await sendMail(staffUser.email, {
      subject: `Reminder: Appointment tomorrow — ${service.name} with ${booking.customerName}`,
      html: wrap(
        `<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Tomorrow's Appointment 📅</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="margin-top:0">Hi,</p>
         <p style="color:#555;font-size:14px">You have an appointment <strong>tomorrow</strong>. Here are the details:</p>

         ${sectionTitle('Appointment')}
         ${tableHtml(`
           ${row('Booking #',  '<span style="font-family:monospace;font-weight:700">' + booking.bookingNumber + '</span>', '#f0fafa')}
           ${row('Service',    service.name)}
           ${row('Date',       date, '#f0fafa')}
           ${row('Time',       booking.bookingTime + ' – ' + endTime)}
           ${row('Duration',   service.duration + ' minutes', '#f0fafa')}
         `)}

         ${sectionTitle('Customer')}
         ${tableHtml(`
           ${row('Name',    booking.customerName, '#f0fafa')}
           ${row('Phone',   booking.customerPhone)}
           ${row('Email',   booking.customerEmail, '#f0fafa')}
           ${row('Gender',  booking.customerGender || '—')}
           ${booking.customerNotes ? row('Notes', booking.customerNotes, '#f0fafa') : ''}
         `)}

         <p style="font-size:13px;color:#555;margin-bottom:0">— <strong>Lough Skin Admin</strong></p>`
      ),
    });
    console.log('[Reminder → Staff]', staffUser.email, booking.bookingNumber);
  } catch (err) {
    console.error('[Reminder → Staff] Failed:', err.message);
  }
};


// ─── Main Reminder Logic ──────────────────────────────────────────────────────

const sendReminders = async () => {
  try {
    const tomorrowStart = moment().tz(TZ).add(1, 'days').startOf('day').toDate();
    const tomorrowEnd   = moment().tz(TZ).add(1, 'days').endOf('day').toDate();

    console.log(`[Reminder Cron] Range (${TZ}): ${tomorrowStart.toISOString()} - ${tomorrowEnd.toISOString()}`);

    const candidates = await Booking.find({
      status:       { $in: ['confirmed', 'pending'] },
      reminderSent: false,
      bookingDate:  { $gte: tomorrowStart, $lte: tomorrowEnd },
    });

    console.log(`[Reminder Cron] Found ${candidates.length} bookings for tomorrow.`);

    for (const booking of candidates) {
      try {
        const service   = await Service.findById(booking.service);
        const staffDoc  = await Staff.findById(booking.staffMember);
        const staffUser = staffDoc ? await User.findById(staffDoc.userId) : null;

        if (!service) continue;

        await Promise.all([
          sendCustomerReminder(booking, service),
          sendStaffReminder(booking, service, staffUser),
        ]);

        booking.reminderSent   = true;
        booking.reminderSentAt = new Date();
        await booking.save();

        console.log('[Reminder Cron] Processed:', booking.bookingNumber);
      } catch (innerErr) {
        console.error('[Reminder Cron] Error:', booking._id, innerErr.message);
      }
    }
  } catch (err) {
    console.error('[Reminder Cron] Fatal error:', err.message);
  }
};


// ─── Cron Schedule ────────────────────────────────────────────────────────────

export const startReminderCron = () => {
  cron.schedule('0 0 * * *', () => {
    console.log('[Reminder Cron] Running daily midnight ...');
    sendReminders();
  }, {
    scheduled: true,
    timezone: TZ,
  });

  console.log(`[Reminder Cron] Scheduled — runs daily (${TZ}).`);
};