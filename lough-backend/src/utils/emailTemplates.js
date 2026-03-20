// utils/emailTemplates.js

const baseWrapper = (content) => `
<div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:30px;background:#F5EDE4;border-radius:20px;border:1px solid #e0d5c8;">
  <h2 style="color:#22B8C8;text-align:center;">Lough Skin</h2>
  <div style="background:white;padding:25px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    ${content}
  </div>
  <p style="color:#999;font-size:12px;margin-top:25px;text-align:center;">
    If you didn't request this, please ignore this email.<br>&copy; 2026 Lough Skin.
  </p>
</div>`;

const actionButton = (link, label) => `
<div style="text-align:center;margin:30px 0;">
  <a href="${link}" style="display:inline-block;background:#22B8C8;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;">
    ${label}
  </a>
</div>`;

const expiryNote = (duration = '5 mins') => `
<p style="color:#666;font-size:14px;background:#fff3cd;padding:10px;border-radius:6px;text-align:center;">
  <strong>Note:</strong> This link expires in <strong>${duration}</strong>.
</p>`;

export const verifyEmailTemplate = (firstName, link) => ({
    subject: 'Verify Your Email – Lough Skin',
    html: baseWrapper(`
        <p style="color:#444;font-size:16px;">Hi <strong>${firstName}</strong>,</p>
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Thank you for registering! Please verify your email to activate your account.
        </p>
        ${actionButton(link, 'Verify My Email')}
        ${expiryNote()}
    `),
});

export const resendVerifyEmailTemplate = (firstName, link) => ({
    subject: 'Verify Your Email – Lough Skin (Resent)',
    html: baseWrapper(`
        <p style="color:#444;">Hi <strong>${firstName}</strong>, here is your new verification link:</p>
        ${actionButton(link, 'Verify My Email')}
        ${expiryNote()}
    `),
});

export const forgotPasswordTemplate = (firstName, link) => ({
    subject: 'Reset Your Password – Lough Skin',
    html: baseWrapper(`
        <p style="color:#444;">Hello <strong>${firstName}</strong>,</p>
        <p style="color:#555;line-height:1.6;">We received a request to reset your password.</p>
        ${actionButton(link, 'Reset My Password')}
        ${expiryNote()}
        <p style="color:#777;font-size:13px;">If you didn't request this, ignore this email.</p>
    `),
});