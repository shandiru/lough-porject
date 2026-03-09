import { google } from 'googleapis';
import Staff from '../models/staff.js';
import User from '../models/user.js';
import config from '../config/index.js';

const getOAuth2Client = () =>
  new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

export const getAuthUrl = (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });
    res.status(200).json({ url });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate Google auth URL', error: err.message });
  }
};

export const handleCallback = async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect(`${config.clientUrl}/dashboard/staff?gcal=denied`);
  if (!code || !state) return res.redirect(`${config.clientUrl}/dashboard/staff?gcal=error`);

  try {
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // ── Step 1: Get the Google account's email ──
    let googleEmail = null;
    try {
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2Api.userinfo.get();
      googleEmail = userInfo.data.email?.toLowerCase().trim();
    } catch {
      return res.redirect(`${config.clientUrl}/dashboard/staff?gcal=error`);
    }

    // ── Step 2: Get staff record + their app login email ──
    const staff = await Staff.findOne({ userId });
    if (!staff) return res.redirect(`${config.clientUrl}/dashboard/staff?gcal=error`);

    const staffUser = await User.findById(userId);
    const staffEmail = staffUser?.email?.toLowerCase().trim();

    // ── Step 3: Block if wrong Google account ──
    if (!googleEmail || googleEmail !== staffEmail) {
      return res.redirect(
        `${config.clientUrl}/dashboard/staff?gcal=wrong_account&expected=${encodeURIComponent(staffEmail)}&got=${encodeURIComponent(googleEmail)}`
      );
    }

    // ── Step 4: Get calendar ID ──
    let calendarId = 'primary';
    try {
      const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
      const calInfo = await calendarApi.calendarList.get({ calendarId: 'primary' });
      calendarId = calInfo.data.id || 'primary';
    } catch {
      calendarId = 'primary';
    }

    // ── Step 5: Save tokens ──
    staff.googleCalendarToken = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || staff.googleCalendarToken?.refresh_token,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
    };
    staff.googleCalendarId = calendarId;
    staff.googleCalendarSyncStatus = {
      lastSync: new Date(),
      status: 'connected',
      errorMessage: '',
    };
    await staff.save();

    res.redirect(`${config.clientUrl}/dashboard/staff?gcal=success`);
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.redirect(`${config.clientUrl}/dashboard/staff?gcal=error`);
  }
};

export const disconnectCalendar = async (req, res) => {
  try {
    const userId = req.user.id;
    const staff = await Staff.findOne({ userId });

    if (!staff) return res.status(404).json({ message: 'Staff record not found' });

    staff.googleCalendarToken = undefined;
    staff.googleCalendarId = undefined;
    staff.googleCalendarSyncStatus = {
      lastSync: new Date(),
      status: 'disconnected',
      errorMessage: '',
    };

    await staff.save();
    res.status(200).json({ message: 'Google Calendar disconnected successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};