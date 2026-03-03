import cron from 'node-cron';
import Staff from '../models/staff.js';
import Leave from '../models/leave.js';

const updateStaffLeaveStatus = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); 

  try {
    
    const activeLeaves = await Leave.find({
      status: 'approved',
      
    });
 console.log(activeLeaves);
    const staffIdsOnLeave = activeLeaves.map(l => l.staffId.toString());

    await Staff.updateMany(
      { _id: { $in: staffIdsOnLeave } },
      {
        $set: {
          isOnLeave: true,
          currentLeave: null, 
        },
      }
    );


    await Staff.updateMany(
      { _id: { $nin: staffIdsOnLeave } },
      {
        $set: {
          isOnLeave: false,
          currentLeave: null,
        },
      }
    );

    console.log(`[Leave Cron] Updated leave status for ${staffIdsOnLeave.length} staff.`);
  } catch (err) {
    console.error('[Leave Cron] Error updating staff leave:', err.message);
  }
};


export const startStaffLeaveCron = () => {
  // Run every 10 seconds
  cron.schedule('*/10 * * * * *', () => {
    console.log('[Leave Cron] Running staff leave update every 10 seconds...');
    updateStaffLeaveStatus();
  });

  console.log('[Leave Cron] Cron job scheduled to run every 10 seconds.');
};