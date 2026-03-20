// utils/bookingControllerTemplates.js
import { TZ } from '../utils/timezone.js';

// ─── Shared UI helpers (self-contained, no circular import) ──────────────────
const row = (label, value, bg = '#ffffff') =>
    value
        ? `<tr style="background:${bg}">
             <td style="padding:8px 12px;font-weight:600;color:#555;width:40%;font-size:13px">${label}</td>
             <td style="padding:8px 12px;color:#222;font-size:13px">${value}</td>
           </tr>`
        : '';

const tableHtml = (rows) =>
    `<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:16px 0">${rows}</table>`;

const sectionTitle = (t) =>
    `<p style="font-weight:700;color:#22B8C8;font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px">${t}</p>`;

const wrap = (gradientFrom, gradientTo, headerHtml, bodyHtml) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#333">
    <div style="background:linear-gradient(135deg,${gradientFrom},${gradientTo});padding:28px 32px;text-align:center;border-radius:12px 12px 0 0">
      ${headerHtml}
    </div>
    <div style="background:#fafafa;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none">
      ${bodyHtml}
    </div>
  </div>`;

const tealWrap   = (h, b) => wrap('#22B8C8', '#1a9aad', h, b);
const redWrap    = (h, b) => wrap('#ef4444', '#dc2626', h, b);
const orangeWrap = (h, b) => wrap('#f97316', '#ea6a10', h, b);

export const formatDate = (dateVal) =>
    new Date(dateVal).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
    });

const footer = `<p style="font-size:11px;color:#bbb;margin-top:24px;text-align:center">Lough Skin · Automated notification</p>`;

const cancelTable = (booking, formattedDate, reason) => tableHtml(`
    ${row('Booking Ref', booking.bookingNumber, '#fff5f5')}
    ${row('Service',     booking.service?.name)}
    ${row('Date',        `${formattedDate} at ${booking.bookingTime}`, '#fff5f5')}
    ${reason ? row('Reason', reason) : ''}
`);

// ─── 1. Admin-created booking — Staff notification ────────────────────────────
export const adminCreateStaffTemplate = (booking, service, staffName, formattedDate) => ({
    subject: `New Booking — ${booking.customerName} — ${booking.bookingNumber}`,
    html: tealWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">New Appointment Booked</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${staffName},</p>
         <p style="font-size:14px">A new appointment has been booked for you by the admin:</p>
         ${tableHtml(`
           ${row('Customer',  booking.customerName, '#f0fafa')}
           ${row('Phone',     booking.customerPhone)}
           ${row('Service',   service.name, '#f0fafa')}
           ${row('Date',      formattedDate)}
           ${row('Time',      booking.bookingTime, '#f0fafa')}
           ${row('Duration',  service.duration + ' min')}
         `)}
         ${footer}`,
    ),
});

// ─── 2. Admin-created booking — Customer notification ─────────────────────────
export const adminCreateCustomerTemplate = (booking, service, staffName, formattedDate) => ({
    subject: `Booking Confirmed — ${booking.bookingNumber}`,
    html: tealWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Booking Confirmed</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${booking.customerName},</p>
         <p style="font-size:14px">Your appointment has been confirmed. Here are your booking details:</p>
         ${tableHtml(`
           ${row('Booking Ref', booking.bookingNumber,            '#f0fafa')}
           ${row('Service',     service.name)}
           ${row('Date',        formattedDate,                    '#f0fafa')}
           ${row('Time',        booking.bookingTime)}
           ${row('Staff',       staffName,                        '#f0fafa')}
           ${row('Duration',    service.duration + ' min')}
           ${row('Price',       '£' + service.price.toFixed(2),  '#f0fafa')}
         `)}
         <p style="font-size:13px;color:#666">If you need to make changes, please contact us directly.</p>
         ${footer}`,
    ),
});

// ─── 3. Cancellation approved — Customer ─────────────────────────────────────
export const cancelApprovedCustomerTemplate = (booking, formattedDate, refundAmount, stripeRefunded) => ({
    subject: `Cancellation Approved — ${booking.bookingNumber}`,
    html: redWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Cancellation Approved</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${booking.customerName},</p>
         <p style="font-size:14px">Your cancellation request has been approved. Your appointment has been cancelled.</p>
         ${cancelTable(booking, formattedDate)}
         ${stripeRefunded
             ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;font-size:13px;color:#166534;margin-top:8px">
                  A refund of <strong>£${(refundAmount / 100).toFixed(2)}</strong> has been issued and will appear within 5–10 business days.
                </div>`
             : ''}
         <p style="font-size:13px;color:#666;margin-top:16px">If you have any questions, please contact us directly.</p>
         ${footer}`,
    ),
});

// ─── 4. Cancellation approved — Staff ────────────────────────────────────────
export const cancelApprovedStaffTemplate = (booking, staffName, formattedDate) => ({
    subject: `[Cancelled] Appointment — ${booking.customerName} — ${booking.bookingNumber}`,
    html: orangeWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Appointment Cancelled</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${staffName},</p>
         <p style="font-size:14px">The customer's cancellation request has been approved and removed from your schedule:</p>
         ${cancelTable(booking, formattedDate)}
         <p style="font-size:12px;color:#aaa;background:#f9fafb;padding:10px;border-radius:8px">Your calendar has been updated automatically.</p>
         ${footer}`,
    ),
});

// ─── 5. Admin-cancelled booking — Customer ───────────────────────────────────
export const adminCancelCustomerTemplate = (booking, formattedDate, reason, refundAmount, stripeRefunded) => ({
    subject: `Booking Cancelled — ${booking.bookingNumber}`,
    html: redWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Booking Cancelled</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${booking.customerName},</p>
         <p style="font-size:14px">We're sorry to inform you that your appointment has been cancelled by our team.</p>
         ${cancelTable(booking, formattedDate, reason)}
         ${stripeRefunded
             ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;font-size:13px;color:#166534;margin-top:8px">
                  A refund of <strong>£${(refundAmount / 100).toFixed(2)}</strong> has been issued and will appear within 5–10 business days.
                </div>`
             : ''}
         <p style="font-size:13px;color:#666;margin-top:16px">If you have any questions, please contact us directly.</p>
         ${footer}`,
    ),
});

// ─── 6. Admin-cancelled booking — Staff ──────────────────────────────────────
export const adminCancelStaffTemplate = (booking, staffName, formattedDate, reason, byAdmin = false) => ({
    subject: `[Cancelled] Appointment — ${booking.customerName} — ${booking.bookingNumber}`,
    html: orangeWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Appointment Cancelled</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${staffName},</p>
         <p style="font-size:14px">The following appointment has been ${byAdmin ? '<strong>cancelled by admin</strong>' : 'cancelled'} and removed from your schedule:</p>
         ${cancelTable(booking, formattedDate, reason)}
         <p style="font-size:12px;color:#aaa;background:#f9fafb;padding:10px;border-radius:8px">Your calendar has been updated automatically.</p>
         ${footer}`,
    ),
});

// ─── 7. Reschedule approved — New Staff ──────────────────────────────────────
export const rescheduleNewStaffTemplate = (booking, service, staffName, formattedDate, finalTime, adminNote) => ({
    subject: `[Reschedule] New Appointment — ${booking.customerName} — ${booking.bookingNumber}`,
    html: tealWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Appointment Rescheduled</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${staffName},</p>
         <p style="font-size:14px">A booking has been rescheduled and assigned to you:</p>
         ${tableHtml(`
           ${row('Customer',       booking.customerName, '#f0fafa')}
           ${row('Service',        service.name)}
           ${row('New Date',       `<span style="font-weight:700;color:#22B8C8">${formattedDate}</span>`, '#f0fafa')}
           ${row('New Time',       `<span style="font-weight:700;color:#22B8C8">${finalTime}</span>`)}
           ${row('Duration',       service.duration + ' min', '#f0fafa')}
           ${row('Customer Phone', booking.customerPhone)}
         `)}
         ${adminNote ? `<p style="font-size:13px;background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;color:#92400e"><strong>Admin Note:</strong> ${adminNote}</p>` : ''}
         ${footer}`,
    ),
});

// ─── 8. Reschedule approved — Old Staff (if reassigned) ──────────────────────
export const rescheduleOldStaffTemplate = (booking, service, oldStaffName, newStaffName, oldDateStr) => ({
    subject: `[Reschedule] Appointment Removed — ${booking.customerName} — ${booking.bookingNumber}`,
    html: orangeWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Appointment Reassigned</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${oldStaffName},</p>
         <p style="font-size:14px">The following appointment has been rescheduled and is <strong>no longer assigned to you</strong>:</p>
         ${tableHtml(`
           ${row('Customer',      booking.customerName, '#fff5f5')}
           ${row('Service',       service.name)}
           ${row('Was Scheduled', `<span style="text-decoration:line-through;color:#999">${oldDateStr} at ${booking.previousBookingTime}</span>`, '#fff5f5')}
           ${row('Now Assigned',  `<span style="font-weight:700;color:#22B8C8">${newStaffName}</span>`)}
         `)}
         <p style="font-size:12px;color:#aaa;background:#f9fafb;padding:10px;border-radius:8px">Your calendar has been updated automatically.</p>
         ${footer}`,
    ),
});

// ─── 9. Reschedule approved — Customer ───────────────────────────────────────
export const rescheduleCustomerTemplate = (booking, service, staffName, formattedDate, finalTime) => ({
    subject: `Your appointment has been rescheduled — ${booking.bookingNumber}`,
    html: tealWrap(
        `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Appointment Rescheduled</h1>
         <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber}</p>`,
        `<p style="font-size:14px">Hi ${booking.customerName},</p>
         <p style="font-size:14px">Your appointment has been successfully rescheduled. Here are your new details:</p>
         ${tableHtml(`
           ${row('Service',   service.name, '#f0fafa')}
           ${row('New Date',  `<span style="font-weight:700;color:#22B8C8">${formattedDate}</span>`)}
           ${row('New Time',  `<span style="font-weight:700;color:#22B8C8">${finalTime}</span>`, '#f0fafa')}
           ${row('Staff',     staffName)}
           ${row('Duration',  service.duration + ' min', '#f0fafa')}
         `)}
         <div style="background:#fff8e1;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin:16px 0">
           <p style="font-weight:700;color:#92400e;margin:0 0 8px;font-size:14px">Action Required — Consultation Form</p>
           <p style="font-size:13px;color:#78350f;margin:0">Because your appointment has been rescheduled, please log in and re-submit your <strong>Client Consultation Form</strong> before your new appointment date.</p>
         </div>
         <p style="font-size:13px;color:#666">If you have any questions, please contact us directly.</p>
         ${footer}`,
    ),
});

// ─── 10. Reschedule approved — Admin summary ─────────────────────────────────
export const rescheduleAdminTemplate = (booking, staffName, formattedDate, finalTime, staffChanged, adminNote) => ({
    subject: `[Admin] Reschedule Approved — ${booking.customerName} — ${booking.bookingNumber}`,
    html: tealWrap(
        `<h1 style="color:#fff;margin:0;font-size:18px;font-weight:700">Reschedule Approved</h1>`,
        `${tableHtml(`
           ${row('Booking',   booking.bookingNumber, '#f0fafa')}
           ${row('Customer',  `${booking.customerName} (${booking.customerEmail})`)}
           ${row('New Date',  `<span style="font-weight:700;color:#22B8C8">${formattedDate} at ${finalTime}</span>`, '#f0fafa')}
           ${row('Staff',     staffName + (staffChanged ? ' <em style="color:#f97316">(changed)</em>' : ''))}
           ${row('Consultation Form', '<span style="color:#ef4444;font-weight:600">Reset — customer must re-submit</span>', '#f0fafa')}
         `)}
         ${adminNote ? `<p style="font-size:13px;background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;color:#92400e;margin-top:12px"><strong>Note:</strong> ${adminNote}</p>` : ''}
         ${footer}`,
    ),
});

// ─── 11. Consultation form submitted — Admin + Staff ─────────────────────────
export const consultationFormTemplate = (booking, formData) => {
    const {
        fullName, dateOfBirth, age, address, phone, email,
        emergencyContact, medicalHistory = [],
        currentMedications, pastSurgeries, treatmentAreasOfInterest, signature,
    } = formData;

    const medList = medicalHistory.length
        ? medicalHistory.map(h => `<li>${h}</li>`).join('')
        : '<li>None selected</li>';

    return {
        subject: `[Consultation Form] ${booking.customerName} — ${booking.bookingNumber}`,
        html: tealWrap(
            `<h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">Client Consultation Form</h1>
             <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${booking.bookingNumber} · ${booking.service?.name || ''}</p>`,
            `<p style="font-size:12px;color:#aaa;margin-top:0">Submitted by customer. Form data is NOT stored on server (privacy).</p>

             ${sectionTitle('Personal Details')}
             ${tableHtml(`
               ${row('Full Name',         fullName         || '—', '#f0fafa')}
               ${row('Date of Birth',     dateOfBirth      || '—')}
               ${row('Age',              age               || '—', '#f0fafa')}
               ${row('Address',          address           || '—')}
               ${row('Phone',            phone             || '—', '#f0fafa')}
               ${row('Email',            email             || '—')}
               ${row('Emergency Contact', emergencyContact || '—', '#f0fafa')}
             `)}

             ${sectionTitle('Medical History')}
             <ul style="margin:0;padding-left:20px;font-size:13px;color:#444">${medList}</ul>

             ${sectionTitle('Additional Information')}
             ${tableHtml(`
               ${row('Current Medications',        currentMedications        || '—', '#f0fafa')}
               ${row('Past Surgeries',             pastSurgeries             || '—')}
               ${row('Treatment Areas of Interest', treatmentAreasOfInterest || '—', '#f0fafa')}
             `)}

             ${sectionTitle('E-Signature')}
             <p style="font-size:13px;background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-style:italic;color:#92400e">"${signature || '—'}"</p>
             ${footer}`,
        ),
    };
};