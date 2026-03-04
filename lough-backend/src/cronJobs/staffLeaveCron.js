import cron from 'node-cron';
import Staff from '../models/staff.js';
import Leave from '../models/leave.js';

const updateStaffLeaveStatus = async () => {
  // Build today's range in UTC to match how MongoDB stores the dates
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  console.log('[Leave Cron] Today UTC range:', todayStart.toISOString(), '→', todayEnd.toISOString());

  try {
    const activeLeaves = await Leave.find({
      status: 'approved',
      startDate: { $lte: todayEnd   },   // leave started on or before end of today
      endDate:   { $gte: todayStart },   // leave ends on or after start of today
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
  // Run every 10 seconds
  cron.schedule('*/10 * * * * *', () => {
    console.log('[Leave Cron] Running staff leave status update...');
    updateStaffLeaveStatus();
  });

  console.log('[Leave Cron] Scheduled — runs every 10 seconds.');
};
