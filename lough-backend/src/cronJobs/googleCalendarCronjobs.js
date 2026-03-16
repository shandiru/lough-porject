import cron from 'node-cron';
import { google } from 'googleapis';
import Staff from '../models/staff.js';
import Googlebooking from '../models/googlebooking.js';
import config from '../config/index.js';

// ─── Timezone ─────────────────────────────────────────────────────────────────
const TZ = 'Asia/Colombo'; // Sri Lanka Standard Time (UTC+5:30)

/**
 * Get today's midnight boundaries in Colombo time.
 * Prevents the UTC-midnight shift issue where server's new Date()
 * would return the wrong calendar day for Sri Lanka users.
 */
const colomboTodayBounds = () => {
  // Get today's date string in Colombo TZ ("YYYY-MM-DD")
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const start = new Date(`${todayStr}T00:00:00+05:30`);
  const end   = new Date(`${todayStr}T23:59:59.999+05:30`);
  return { start, end, todayStr };
};

const createOAuthClient = () =>
  new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );


const refreshAllTokens = async () => {
  try {
    const connectedStaff = await Staff.find({
      'googleCalendarToken.refresh_token': { $exists: true, $ne: null },
      'googleCalendarSyncStatus.status': 'connected',
    }).select('_id googleCalendarToken googleCalendarSyncStatus');

    if (!connectedStaff.length) return;

    console.log(`[Token Refresh] Processing ${connectedStaff.length} staff members.`);

    await Promise.allSettled(
      connectedStaff.map(async (staff) => {
        try {
          const oauth2Client = createOAuthClient();
          oauth2Client.setCredentials({
            refresh_token: staff.googleCalendarToken.refresh_token,
          });

          const { credentials } = await oauth2Client.refreshAccessToken();

          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarToken.access_token': credentials.access_token,
            'googleCalendarToken.expiry_date': credentials.expiry_date || null,
            'googleCalendarSyncStatus.status': 'connected',
            'googleCalendarSyncStatus.errorMessage': null,
            'googleCalendarSyncStatus.lastSync': new Date(),
          }, { returnDocument: 'after' });

        } catch (err) {
          console.error(`[Token Refresh] Failed for staff ${staff._id}:`, err.message);

          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarSyncStatus.status': 'error',
            'googleCalendarSyncStatus.errorMessage': 'Token refresh failed. Manual reconnection required.',
          }, { returnDocument: 'after' });
        }
      })
    );
    console.log('[Token Refresh] Job complete.');
  } catch (error) {
    console.error('[Token Refresh] Fatal Error:', error.message);
  }
};


const syncAndCleanBookings = async () => {
  // ✅ FIX: use Colombo-aware today boundaries (not server UTC midnight)
  const { start: todayStart, todayStr } = colomboTodayBounds();
  console.log(`[Sync] Colombo today: ${todayStr} | UTC boundary: ${todayStart.toISOString()}`);

  try {
    await Googlebooking.deleteMany({ date: { $lt: todayStart } });

    const connectedStaff = await Staff.find({
      'googleCalendarToken.refresh_token': { $exists: true, $ne: null },
      'googleCalendarSyncStatus.status': 'connected',
    }).select('_id googleCalendarToken googleCalendarId');

    if (!connectedStaff.length) return;

    await Promise.allSettled(
      connectedStaff.map(async (staff) => {
        try {
          const oauth2Client = createOAuthClient();
          oauth2Client.setCredentials({
            access_token: staff.googleCalendarToken.access_token,
            refresh_token: staff.googleCalendarToken.refresh_token,
            expiry_date: staff.googleCalendarToken.expiry_date,
          });

          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

          const eventsResponse = await calendar.events.list({
            calendarId: staff.googleCalendarId || 'primary',
            timeMin: todayStart.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 100,
          });

          const googleEvents = eventsResponse.data.items || [];
          console.log(googleEvents);

          for (const event of googleEvents) {
            try {
              const startRaw = event.start?.dateTime || event.start?.date;
              const endRaw   = event.end?.dateTime   || event.end?.date;
              if (!startRaw || !endRaw) continue;

              const startDate = new Date(startRaw);
              const endDate   = new Date(endRaw);
              if (startDate < todayStart) continue;

              // ✅ FIX: extract date portion in Colombo TZ (not server local)
              const dateOnlyStr = startDate.toLocaleDateString('en-CA', { timeZone: TZ }); // "YYYY-MM-DD"
              const dateOnly    = new Date(`${dateOnlyStr}T00:00:00+05:30`);

              // ✅ FIX: extract HH:MM in Colombo TZ (not server local toTimeString)
              const startTime = startDate.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
              const endTime   = endDate.toLocaleTimeString('en-GB',   { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

              await Googlebooking.findOneAndUpdate(
                {
                  staffId: staff._id,
                  googleCalendarEventId: event.id
                },
                {
                  staffId: staff._id,
                  date: dateOnly,
                  startTime,
                  endTime,
                  googleCalendarEventId: event.id,
                  googleCalendarSynced: true,
                },
                {
                  upsert: true,
                  returnDocument: 'after',
                  setDefaultsOnInsert: true
                }
              );
            } catch (storeErr) {
              if (storeErr.code !== 11000) {
                console.error(`[Sync] Error storing event ${event.id}:`, storeErr.message);
              }
            }
          }

          await Staff.findByIdAndUpdate(staff._id, {
            'googleCalendarSyncStatus.lastSync': new Date(),
          }, { returnDocument: 'after' });

        } catch (staffErr) {
          console.error(`[Sync] Failed for staff ${staff._id}:`, staffErr.message);
        }
      })
    );
    console.log('[Sync] Calendar sync completed.');
  } catch (error) {
    console.error('[Sync] Fatal Job Error:', error.message);
  }
};


export const startGoogleCalendarCrons = () => {
  cron.schedule('0 * * * *', refreshAllTokens);
  cron.schedule('*/1 * * * *', syncAndCleanBookings);
};