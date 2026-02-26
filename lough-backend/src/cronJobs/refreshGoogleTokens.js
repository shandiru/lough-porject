import cron from 'node-cron';
import { google } from 'googleapis';
import Staff from '../models/staff.js';
import Googlebooking from '../models/googlebooking.js';

// ─── OAuth2 Client ────────────────────────────────────────────────────────────
const createOAuthClient = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

// ══════════════════════════════════════════════════════════════════════════════
//  CRON 1 — Every 1 Hour → Refresh Access Tokens
// ══════════════════════════════════════════════════════════════════════════════
const refreshAllTokens = async () => {
  console.log('[Token Refresh] 🔄 Starting token refresh job...');

  try {
    const connectedStaff = await Staff.find({
      'googleCalendarToken.refresh_token': { $exists: true, $ne: null },
      'googleCalendarSyncStatus.status':   'connected',
    }).select('_id googleCalendarToken googleCalendarSyncStatus');

    if (!connectedStaff.length) {
      console.log('[Token Refresh] ℹ️  No connected staff. Skipping.');
      return;
    }

    console.log(`[Token Refresh] 👥 Found ${connectedStaff.length} staff to refresh.`);

    await Promise.allSettled(
      connectedStaff.map(async (staff) => {
        try {
          const oauth2Client = createOAuthClient();
          oauth2Client.setCredentials({
            refresh_token: staff.googleCalendarToken.refresh_token,
          });

          const { credentials } = await oauth2Client.refreshAccessToken();

          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarToken.access_token':      credentials.access_token,
            'googleCalendarToken.expiry_date':       credentials.expiry_date || null,
            'googleCalendarSyncStatus.status':       'connected',
            'googleCalendarSyncStatus.errorMessage': null,
            'googleCalendarSyncStatus.lastSync':     new Date(),
          });

          console.log(`[Token Refresh] ✅ Refreshed for staff: ${staff._id}`);

        } catch (err) {
          console.error(`[Token Refresh] ❌ Failed for staff: ${staff._id}`, err.message);
          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarSyncStatus.status':       'error',
            'googleCalendarSyncStatus.errorMessage': 'Token refresh failed. Please reconnect Google Calendar.',
          });
        }
      })
    );

    console.log('[Token Refresh] ✅ Token refresh job complete.');
  } catch (error) {
    console.error('[Token Refresh] ❌ Job error:', error.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  CRON 2 — Every 1 Min (test) → Fetch Google Calendar events + store DB
// ══════════════════════════════════════════════════════════════════════════════
const syncAndCleanBookings = async () => {
  console.log('[GCal Sync] 🔄 Starting sync + cleanup job...');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    // ── STEP 1: Delete past bookings from DB ──────────────────────────────────
    const deleted = await Googlebooking.deleteMany({
      date: { $lt: todayStart },
    });
    if (deleted.deletedCount > 0) {
      console.log(`[GCal Sync] 🗑️  Deleted ${deleted.deletedCount} past bookings from DB.`);
    }

    // ── STEP 2: Find all connected staff ──────────────────────────────────────
    const connectedStaff = await Staff.find({
      'googleCalendarToken.refresh_token': { $exists: true, $ne: null },
      'googleCalendarSyncStatus.status':   'connected',
    }).select('_id googleCalendarToken googleCalendarId');

    if (!connectedStaff.length) {
      console.log('[GCal Sync] ℹ️  No connected staff. Skipping.');
      return;
    }

    console.log(`[GCal Sync] 👥 Found ${connectedStaff.length} connected staff.`);

    await Promise.allSettled(
      connectedStaff.map(async (staff) => {
        try {
          const oauth2Client = createOAuthClient();
          oauth2Client.setCredentials({
            access_token:  staff.googleCalendarToken.access_token,
            refresh_token: staff.googleCalendarToken.refresh_token,
            expiry_date:   staff.googleCalendarToken.expiry_date,
          });

          const calendar   = google.calendar({ version: 'v3', auth: oauth2Client });
          const calendarId = staff.googleCalendarId || 'primary';

          // ── FETCH ALL EVENTS from Google Calendar (today + future) ────────
          console.log(`\n[GCal Sync] 📡 Fetching events from Google Calendar for staff: ${staff._id}`);

          const eventsResponse = await calendar.events.list({
            calendarId,
            timeMin:      todayStart.toISOString(),
            singleEvents: true,
            orderBy:      'startTime',
            maxResults:   250,
          });

          const googleEvents = eventsResponse.data.items || [];

          // ── LOG ALL FETCHED EVENTS ────────────────────────────────────────
          if (googleEvents.length === 0) {
            console.log(`[GCal Sync] ℹ️  No events found in Google Calendar for staff: ${staff._id}`);
          } else {
            console.log(`[GCal Sync] 📋 Found ${googleEvents.length} events for staff: ${staff._id}`);
            console.log('─'.repeat(60));
            googleEvents.forEach((event, index) => {
              const start = event.start?.dateTime || event.start?.date || 'N/A';
              const end   = event.end?.dateTime   || event.end?.date   || 'N/A';
              console.log(`  [${index + 1}] 📅 "${event.summary || 'No Title'}"`);
              console.log(`       🕐 Start     : ${start}`);
              console.log(`       🕑 End       : ${end}`);
              console.log(`       🆔 Event ID  : ${event.id}`);
              console.log('');
            });
            console.log('─'.repeat(60));
          }

          // ── STORE EVENTS INTO DB (upsert — today + future only) ───────────
          for (const event of googleEvents) {
            try {
              const startRaw = event.start?.dateTime || event.start?.date;
              const endRaw   = event.end?.dateTime   || event.end?.date;

              if (!startRaw || !endRaw) continue;

              const startDate = new Date(startRaw);
              const endDate   = new Date(endRaw);

              if (startDate < todayStart) continue;

              const dateOnly = new Date(startDate);
              dateOnly.setHours(0, 0, 0, 0);

              const startTime = startDate.toTimeString().slice(0, 5); // "10:00"
              const endTime   = endDate.toTimeString().slice(0, 5);   // "11:00"

              // Upsert by staffId + googleCalendarEventId
              await Googlebooking.findOneAndUpdate(
                {
                  staffId:               staff._id,
                  googleCalendarEventId: event.id,
                },
                {
                  staffId:               staff._id,
                  date:                  dateOnly,
                  startTime,
                  endTime,
                  googleCalendarEventId: event.id,
                  googleCalendarSynced:  true,
                },
                { upsert: true, new: true }
              );

              console.log(`[GCal Sync] 💾 Stored: "${event.summary || 'Appointment'}" → ${dateOnly.toDateString()} ${startTime}-${endTime}`);

            } catch (storeErr) {
              console.error(`[GCal Sync] ❌ Store failed for event: ${event.id}`, storeErr.message);
            }
          }

          // Update last sync time
          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarSyncStatus.lastSync': new Date(),
          });

          console.log(`[GCal Sync] ✅ Done for staff: ${staff._id}\n`);

        } catch (staffErr) {
          console.error(`[GCal Sync] ❌ Sync failed for staff: ${staff._id}`, staffErr.message);
        }
      })
    );

    console.log('[GCal Sync] ✅ Sync + cleanup job complete.');

  } catch (error) {
    console.error('[GCal Sync] ❌ Job error:', error.message);
  }
};


export const startGoogleCalendarCrons = () => {

  // Every 1 hour — refresh access tokens
  cron.schedule('0 * * * *', refreshAllTokens);
  console.log('[Cron] 🟢 Token refresh cron registered (every 1 hour)');

  // Every 1 min for testing (change to */15 for production)
  cron.schedule('*/15 * * * *', syncAndCleanBookings);
  console.log('[Cron] 🟢 Sync + cleanup cron registered (every 1 min - test mode)');

};