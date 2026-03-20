// utils/leaveEmailTemplates.js

const baseWrapper = (color, content) => `
<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#F5EDE4;border-radius:16px;">
  ${content}
  <p style="color:#aaa;font-size:12px;margin-top:20px;">Lough Skin Staff Portal &copy; 2026</p>
</div>`;

const statusBadge = (status) => {
    const color = status === 'approved' ? '#22B8C8' : '#ef4444';
    const emoji = status === 'approved' ? '✅' : '❌';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return { color, emoji, label };
};

// ─── Leave Status Email ───────────────────────────────────────────────────────
export const leaveStatusTemplate = (name, type, startDate, endDate, status, adminNote, isHourly, startTime, endTime) => {
    const { color, emoji, label } = statusBadge(status);

    const dateRange = isHourly
        ? `${new Date(startDate).toDateString()} · ${startTime} – ${endTime}`
        : `${new Date(startDate).toDateString()} → ${new Date(endDate).toDateString()}`;

    return {
        subject: `Your Leave Request has been ${status} – Lough Skin`,
        html: baseWrapper(color, `
            <h2 style="color:${color};margin-bottom:8px;">Leave ${label} ${emoji}</h2>
            <p style="color:#555;">Hi <strong>${name}</strong>,</p>
            <p style="color:#555;">Your leave request has been <strong>${status}</strong>.</p>
            <div style="background:#fff;border-radius:12px;padding:16px;margin:16px 0;">
              <p style="margin:4px 0;"><strong>Type:</strong> ${type.charAt(0).toUpperCase() + type.slice(1)}</p>
              <p style="margin:4px 0;"><strong>${isHourly ? 'Hours' : 'Dates'}:</strong> ${dateRange}</p>
              ${adminNote ? `<p style="margin:8px 0 0;color:#555;"><strong>Admin Note:</strong> ${adminNote}</p>` : ''}
            </div>
        `),
    };
};