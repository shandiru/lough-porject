// utils/adminEmailTemplates.js

const baseWrapper = (content) => `
<div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:30px;background:#F5EDE4;border-radius:20px;border:1px solid #e0d5c8;">
  <h2 style="color:#22B8C8;text-align:center;">Lough Skin Admin Portal</h2>
  <div style="background:white;padding:25px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    ${content}
  </div>
  <p style="color:#999;font-size:12px;margin-top:25px;text-align:center;">
    If you were not expecting this, please contact the main administrator or ignore this email.<br>
    &copy; 2026 Lough Skin. All rights reserved.
  </p>
</div>`;

const actionButton = (link, label) => `
<div style="text-align:center;margin:30px 0;">
  <a href="${link}" style="display:inline-block;background:#22B8C8;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;">
    ${label}
  </a>
</div>`;

const expiryNote = (duration = '5 mins') => `
<p style="color:#856404;font-size:14px;background:#fff3cd;padding:10px;border-radius:6px;text-align:center;">
  <strong>Security Notice:</strong> This link is valid for <strong>${duration}</strong> only.
</p>`;

// ─── Templates ────────────────────────────────────────────────────────────────

export const inviteUserTemplate = (firstName, role, link) => ({
    subject: "You're Invited – Lough Skin Admin Portal",
    html: baseWrapper(`
        <p style="color:#444;font-size:16px;">Hi <strong>${firstName}</strong>,</p>
        <p style="color:#555;font-size:15px;line-height:1.6;">
          You have been invited to join the <strong>Lough Skin Management Team</strong> as 
          <strong style="text-transform:capitalize;">${role}</strong>.
          To access your dashboard, please set up your secure password first.
        </p>
        ${actionButton(link, 'Setup Admin Account')}
        ${expiryNote()}
    `),
});

export const staffInviteTemplate = (link) => ({
    subject: 'You have been invited to Lough Skin',
    html: baseWrapper(`
        <h2 style="color:#22B8C8;margin-bottom:8px;">Welcome to Lough Skin!</h2>
        <p style="color:#555;margin-bottom:24px;">You've been invited as a staff member. Click the button below to set your password and activate your account.</p>
        ${actionButton(link, 'Set Up My Account')}
        ${expiryNote('5 mins')}
    `),
});

export const emailChangeVerificationTemplate = (firstName, link) => ({
    subject: 'Verify Your New Email – Lough Skin',
    html: baseWrapper(`
        <p style="color:#444;font-size:16px;">Hi <strong>${firstName}</strong>,</p>
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Your email address on your Lough Skin staff account has been updated.<br/>
          Please verify your new email address to continue accessing your account.
        </p>
        ${actionButton(link, 'Verify New Email')}
        <div style="background:#fff3cd;padding:12px;border-radius:6px;text-align:center;">
          <p style="color:#856404;font-size:13px;margin:0;">
            <strong>Note:</strong> This link expires in <strong>24 hours</strong>. Until verified, you will not be able to log in.
          </p>
        </div>
        <p style="color:#999;font-size:12px;margin-top:16px;text-align:center;">
          If you did not expect this change, contact your administrator immediately.
        </p>
    `),
});

export const adminResetPasswordTemplate = (link) => ({
    subject: 'Reset Your Password – Lough Skin',
    html: baseWrapper(`
        <p style="color:#444;font-size:16px;">Hello,</p>
        <p style="color:#555;font-size:15px;line-height:1.6;">
          We received a request to reset the password for your <strong>Lough Skin</strong> account.
          No changes have been made yet.
        </p>
        ${actionButton(link, 'Reset My Password')}
        ${expiryNote()}
        <p style="color:#777;font-size:13px;">If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
    `),
});