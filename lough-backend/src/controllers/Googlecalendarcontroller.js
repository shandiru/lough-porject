import { google } from 'googleapis';
import Staff from '../models/staff.js';

// ─── Build OAuth2 client ──────────────────────────────────────────────────────
const getOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:5000/api/google/callback"
  );

// ────────────────────────────────────────────────────────────────────────────
// GET /api/google/auth-url
// Staff clicks "Connect" → frontend calls this → gets URL → redirects browser to Google
// ────────────────────────────────────────────────────────────────────────────
export const getAuthUrl = (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();

    // Embed logged-in user's ID in state so callback knows who to save tokens for
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',  // needed to get refresh_token
      prompt:      'consent',  // force consent screen so refresh_token is always returned
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      state,
    });

    res.status(200).json({ url });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate Google auth URL', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/google/callback?code=...&state=...
// Google redirects here after staff approves → exchange code for tokens → save to Staff DB
// NO verifyToken here — Google calls this, not the app
// ────────────────────────────────────────────────────────────────────────────
export const handleCallback = async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.CLIENT_URL}/dashboard/staff?gcal=denied`);
  }

  if (!code || !state) {
    return res.redirect(`${process.env.CLIENT_URL}/dashboard/staff?gcal=error`);
  }

  try {
    // 1. Decode state → get userId
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));

    // 2. Exchange authorization code for tokens
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // 3. Get primary calendar ID
    oauth2Client.setCredentials(tokens);
    let calendarId = 'primary';
    try {
      const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
      const calInfo     = await calendarApi.calendarList.get({ calendarId: 'primary' });
      calendarId        = calInfo.data.id || 'primary';
    } catch {
      calendarId = 'primary';
    }

    // 4. Find Staff document
    const staff = await Staff.findOne({ userId });
    if (!staff) {
      console.error(`Google callback: no Staff found for userId ${userId}`);
      return res.redirect(`${process.env.CLIENT_URL}/dashboard/staff?gcal=error`);
    }

    // 5. Save tokens to Staff document
    staff.googleCalendarToken = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || staff.googleCalendarToken?.refresh_token,
      token_type:    tokens.token_type,
      expiry_date:   tokens.expiry_date,
    };
    staff.googleCalendarId = calendarId;
    staff.googleCalendarSyncStatus = {
      lastSync:     new Date(),
      status:       'connected',
      errorMessage: '',
    };

    await staff.save();

    // 6. Redirect back to dashboard with success flag
    res.redirect(`${process.env.CLIENT_URL}/dashboard/staff?gcal=success`);
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.redirect(`${process.env.CLIENT_URL}/dashboard/staff?gcal=error`);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/google/disconnect
// Clears Google Calendar tokens from Staff document + revokes with Google
// ────────────────────────────────────────────────────────────────────────────
export const disconnectCalendar = async (req, res) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

    // Best-effort revoke with Google
    if (staff.googleCalendarToken?.access_token) {
      try {
        const oauth2Client = getOAuth2Client();
        await oauth2Client.revokeToken(staff.googleCalendarToken.access_token);
      } catch {
        // Silently ignore — we still clear from DB
      }
    }

    // Clear all Google data
    staff.googleCalendarToken     = undefined;
    staff.googleCalendarId        = undefined;
    staff.googleCalendarSyncStatus = {
      lastSync:     new Date(),
      status:       'disconnected',
      errorMessage: '',
    };

    await staff.save();

    res.status(200).json({ message: 'Google Calendar disconnected' });
  } catch (err) {
    res.status(500).json({ message: 'Error disconnecting', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// UTILITY — import in booking controller to create calendar events
// ────────────────────────────────────────────────────────────────────────────
export const getAuthClientForStaff = async (staffId) => {
  const staff = await Staff.findById(staffId);
  if (!staff?.googleCalendarToken?.access_token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(staff.googleCalendarToken);

  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      staff.googleCalendarToken.access_token = newTokens.access_token;
      if (newTokens.expiry_date) staff.googleCalendarToken.expiry_date = newTokens.expiry_date;
      staff.googleCalendarSyncStatus.lastSync = new Date();
      await staff.save();
    }
  });

  return oauth2Client;
};