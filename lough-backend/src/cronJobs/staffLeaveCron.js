import cron from 'node-cron';
import Staff from '../models/staff.js';
import Leave from '../models/leave.js';
import { todayBounds } from '../utils/timezone.js';



const updateStaffLeaveStatus = async () => {

  const { start: todayStart, end: todayEnd, dateStr: todayStr } = todayBounds();

  console.log(`[Leave Cron] Today (${process.env.APP_TIMEZONE || 'Europe/London'}): ${todayStr} | UTC range: ${todayStart.toISOString()} → ${todayEnd.toISOString()}`);

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