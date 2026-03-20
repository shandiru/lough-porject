// utils/bookingEmailTemplates.js
import { fromMins, toMins } from '../controllers/bookingController.js';
import { TZ } from '../utils/timezone.js';

// ─── Shared UI helpers ────────────────────────────────────────────────────────
export const row = (label, value, bg = '#ffffff') =>
    value
        ? `<tr style="background:${bg}">
         <td style="padding:10px 14px;font-weight:600;color:#555;width:38%;font-size:13px">${label}</td>
         <td style="padding:10px 14px;color:#222;font-size:13px">${value}</td>
       </tr>`
        : '';

export const tableHtml = (rows) =>
    `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden">${rows}</table>`;

export const sectionTitle = (t) =>
    `<p style="font-weight:700;color:#22B8C8;font-size:14px;margin:20px 0 4px;text-transform:uppercase;letter-spacing:.5px">${t}</p>`;

export const wrap = (headerHtml, bodyHtml) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#333">
    <div style="background:linear-gradient(135deg,#22B8C8 0%,#1a9aad 100%);padding:28px 32px;text-align:center;border-radius:12px 12px 0 0">
      ${headerHtml}
    </div>
    <div style="background:#fafafa;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none">
      ${bodyHtml}
    </div>
    <p style="text-align:center;font-size:11px;color:#bbb;margin-top:20px">Lough Skin · Automated notification</p>
  </div>`;

export const formatDateColombo = (dateVal) =>
    new Date(dateVal).toLocaleDateString('en-GB', {
        timeZone: TZ,
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

// ─── Templates ────────────────────────────────────────────────────────────────

export const customerBookingTemplate = (booking, service) => {
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const paid    = (booking.paidAmount       / 100).toFixed(2);
    const balance = (booking.balanceRemaining / 100).toFixed(2);
    const total   = (booking.totalAmount      / 100).toFixed(2);
    const date    = formatDateColombo(booking.bookingDate);

    return {
        from:    `"Lough Skin" <${booking.customerEmail}>`,
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
    };
};

export const staffBookingTemplate = (booking, service, staffUser) => {
    const endTime = fromMins(toMins(booking.bookingTime) + service.duration);
    const date    = formatDateColombo(booking.bookingDate);

    return {
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
    };
};

export const adminBookingTemplate = (booking, service, staffUser) => {
    const endTime   = fromMins(toMins(booking.bookingTime) + service.duration);
    const paid      = (booking.paidAmount       / 100).toFixed(2);
    const balance   = (booking.balanceRemaining / 100).toFixed(2);
    const deposit   = (booking.depositAmount    / 100).toFixed(2);
    const total     = (booking.totalAmount      / 100).toFixed(2);
    const date      = formatDateColombo(booking.bookingDate);
    const staffName = staffUser ? `${staffUser.firstName} ${staffUser.lastName}` : 'Unknown';

    const paymentBadge = booking.paymentType === 'full'
        ? '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">FULL PAYMENT</span>'
        : '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700">DEPOSIT</span>';

    return {
        subject: `[Admin] New Booking ${booking.bookingNumber} — ${booking.customerName} — ${service.name}`,
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
               ${row('Type',           paymentBadge, '#f0fafa')}
               ${row('Total',          '<strong style="font-size:15px">£' + total + '</strong>')}
               ${row('Deposit amount', '£' + deposit, '#f0fafa')}
               ${row('Paid now',       '<span style="color:#22B8C8;font-weight:700;font-size:15px">£' + paid + '</span>')}
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
    };
};