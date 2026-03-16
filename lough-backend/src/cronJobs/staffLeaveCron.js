import cron from 'node-cron';
import Staff from '../models/staff.js';
import Leave from '../models/leave.js';

// ─── Timezone ─────────────────────────────────────────────────────────────────
const TZ = 'Asia/Colombo'; // Sri Lanka Standard Time (UTC+5:30)

const updateStaffLeaveStatus = async () => {
  // ✅ FIX: Build today's range in Colombo time (not UTC).
  // Without this, a server running at e.g. 20:00 UTC = 01:30 AM Colombo next day
  // would use the WRONG calendar date for leave checks.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // "YYYY-MM-DD"
  const todayStart = new Date(`${todayStr}T00:00:00+05:30`);
  const todayEnd   = new Date(`${todayStr}T23:59:59.999+05:30`);

  console.log(`[Leave Cron] Colombo today: ${todayStr} | UTC range: ${todayStart.toISOString()} → ${todayEnd.toISOString()}`);

  try {
    const activeLeaves = await Leave.find({
      status:    'approved',
      startDate: { $lte: todayEnd   },
      endDate:   { $gte: todayStart },
    });

    console.log('[Leave Cron] Active leaves found:', activeLeaves.length);
    activeLeaves.forEach(l =>
      console.log(`  → staffId: ${l.staffId} | ${l.startDate.toISOString()} → ${l.endDate.toISOString()}`)
    );

    const staffIdsOnLeave = activeLeaves.map(l => l.staffId.toString());

    for (const leave of activeLeaves) {
      await Staff.findByIdAndUpdate(leave.staffId, {
        $set: {
          isOnLeave: true,
          currentLeave: {
            startDate: leave.startDate,
            endDate:   leave.endDate,
            type:      leave.type,
            reason:    leave.reason,
          },
        },
      });
    }

    await Staff.updateMany(
      { _id: { $nin: staffIdsOnLeave } },
      {
        $set: {
          isOnLeave:    false,
          currentLeave: null,
        },
      }
    );

    console.log(`[Leave Cron] ${staffIdsOnLeave.length} staff on leave today, rest cleared.`);
  } catch (err) {
    console.error('[Leave Cron] Error:', err.message);
  }
};

export const startStaffLeaveCron = () => {
  cron.schedule('*/10 * * * * *', () => {
    console.log('[Leave Cron] Running staff leave status update...');
    updateStaffLeaveStatus();
  });

  console.log('[Leave Cron] Scheduled — runs every 10 seconds.');
};