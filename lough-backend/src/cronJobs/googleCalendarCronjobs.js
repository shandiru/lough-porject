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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const thirtyOneDaysLater = new Date();
  thirtyOneDaysLater.setDate(todayStart.getDate() + 31);
  thirtyOneDaysLater.setHours(23, 59, 59, 999);

  try {
    await Googlebooking.deleteMany({ date: { $lt: todayStart } });

    const connectedStaff = await Staff.find({
      'googleCalendarToken.refresh_token': { $exists: true, $ne: null },
      'googleCalendarSyncStatus.status': 'connected',
    });

    await Promise.allSettled(
      connectedStaff.map(async (staff) => {
        const oauth2Client = createOAuthClient();
        oauth2Client.setCredentials(staff.googleCalendarToken);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        let allEvents = [];
        let pageToken = null;

        
        do {
          const eventsResponse = await calendar.events.list({
            calendarId: staff.googleCalendarId || 'primary',
            timeMin: todayStart.toISOString(),
            timeMax: thirtyOneDaysLater.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            pageToken: pageToken, 
          });

          allEvents = allEvents.concat(eventsResponse.data.items || []);
          pageToken = eventsResponse.data.nextPageToken; 
        } while (pageToken); 

        console.log(`[Sync] Staff ${staff._id}: Total events fetched: ${allEvents.length}`);

        for (const event of allEvents) {
         
          const startRaw = event.start?.dateTime || event.start?.date;
          if (!startRaw) continue;
          
          const startDate = new Date(startRaw);
          const dateOnly = new Date(startDate);
          dateOnly.setHours(0, 0, 0, 0);

          await Googlebooking.findOneAndUpdate(
            { staffId: staff._id, googleCalendarEventId: event.id },
            {
              staffId: staff._id,
              date: dateOnly,
              startTime: startDate.toTimeString().split(' ')[0].substring(0, 5),
              googleCalendarEventId: event.id,
              googleCalendarSynced: true,
            },
            { upsert: true, returnDocument: 'after' }
          );
        }
      })
    );
  } catch (error) {
    console.error('[Sync] Fatal Error:', error.message);
  }
};


export const startGoogleCalendarCrons = () => {
  cron.schedule('0 * * * *', refreshAllTokens);
  cron.schedule('*/15 * * * *', syncAndCleanBookings);
};