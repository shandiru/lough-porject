// controllers/leaveController.js
import Leave   from '../models/leave.js';
import Staff   from '../models/staff.js';
import Booking from '../models/bookingModel.js';
import { sendMail }           from '../utils/mailer.js';                  // ✅ Singleton
import { leaveStatusTemplate } from '../utils/leaveEmailTemplates.js';    // ✅ Template
import { writeAuditLog }      from '../utils/auditLogger.js';

// ─── Helper ───────────────────────────────────────────────────────────────────
const toMins = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// ─── Helper: check booking conflicts ─────────────────────────────────────────
const getConflictingBookings = async (staffId, startDate, endDate, isHourly, startTime, endTime) => {
    const leaveStart = new Date(startDate); leaveStart.setHours(0, 0, 0, 0);
    const leaveEnd   = new Date(isHourly ? startDate : endDate); leaveEnd.setHours(23, 59, 59, 999);

    const allBookings = await Booking.find({
        staffMember: staffId,
        bookingDate: { $gte: leaveStart, $lte: leaveEnd },
        status: { $in: ['pending', 'confirmed'] },
    }).populate('service', 'name').sort({ bookingDate: 1, bookingTime: 1 });

    return allBookings.filter(bk => {
        if (!isHourly) return true;
        const bStart = toMins(bk.bookingTime);
        const bEnd   = bStart + (bk.duration || 60);
        const lStart = toMins(startTime);
        const lEnd   = toMins(endTime);
        return bStart < lEnd && bEnd > lStart;
    });
};

// ─── Helper: group conflicts by day ──────────────────────────────────────────
const groupByDay = (bookings) => {
    const byDay = {};
    for (const bk of bookings) {
        const dk = new Date(bk.bookingDate).toDateString();
        if (!byDay[dk]) byDay[dk] = [];
        byDay[dk].push({
            bookingNumber: bk.bookingNumber,
            time:    bk.bookingTime,
            service: bk.service?.name || 'Unknown',
            status:  bk.status,
        });
    }
    return byDay;
};


// ─── Apply Leave ──────────────────────────────────────────────────────────────
export const applyLeave = async (req, res) => {
    try {
        const { type, startDate, endDate, reason, isHourly, startTime, endTime } = req.body;

        if (isHourly) {
            if (!startTime || !endTime)
                return res.status(400).json({ message: 'startTime and endTime are required for hourly leave.' });
            if (toMins(startTime) >= toMins(endTime))
                return res.status(400).json({ message: 'startTime must be before endTime.' });

            const s = new Date(startDate); s.setHours(0, 0, 0, 0);
            const e = new Date(endDate);   e.setHours(0, 0, 0, 0);
            if (s.getTime() !== e.getTime())
                return res.status(400).json({ message: 'Hourly leave must be on a single day (startDate must equal endDate).' });
        }

        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

        const overlap = await Leave.findOne({
            staffId: staff._id,
            status: { $in: ['pending', 'approved'] },
            startDate: { $lte: new Date(endDate) },
            endDate:   { $gte: new Date(startDate) },
        });
        if (overlap) return res.status(400).json({ message: 'You already have a leave overlapping these dates.' });

        const conflicting = await getConflictingBookings(staff._id, startDate, endDate, isHourly, startTime, endTime);
        if (conflicting.length > 0) {
            return res.status(400).json({
                message: `You have ${conflicting.length} booking(s) that conflict with this leave period. Please resolve them first.`,
                conflictingBookings: groupByDay(conflicting),
            });
        }

        const leave = await Leave.create({
            staffId:   staff._id,
            type,
            startDate: new Date(startDate),
            endDate:   new Date(isHourly ? startDate : endDate),
            reason,
            isHourly:  !!isHourly,
            startTime: isHourly ? startTime : undefined,
            endTime:   isHourly ? endTime   : undefined,
        });

        const populated = await Leave.findById(leave._id).populate({
            path: 'staffId',
            populate: { path: 'userId', select: 'firstName lastName email profileImage' },
        });

        const staffUser = populated.staffId?.userId;
        await writeAuditLog({
            user: req.user,
            entity: 'leave',
            entityId: leave._id,
            action: 'leave.applied',
            description: `Leave applied by ${staffUser?.firstName || ''} ${staffUser?.lastName || ''}: ${type} from ${startDate} to ${endDate || startDate}${isHourly ? ` (${startTime}–${endTime})` : ''}`,
            after: { type, startDate, endDate, isHourly, startTime, endTime, reason },
            req,
        });

        res.status(201).json({ message: 'Leave request submitted!', leave: populated });
    } catch (err) {
        res.status(400).json({ message: 'Error applying leave', error: err.message });
    }
};


// ─── Get My Leaves ────────────────────────────────────────────────────────────
export const getMyLeaves = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });
        const leaves = await Leave.find({ staffId: staff._id }).sort({ createdAt: -1 });
        res.status(200).json(leaves);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Cancel Leave ─────────────────────────────────────────────────────────────
export const cancelLeave = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
        if (!leave) return res.status(404).json({ message: 'Leave not found' });
        if (leave.status !== 'pending')
            return res.status(400).json({ message: 'Only pending leaves can be cancelled' });

        leave.status = 'cancelled';
        await leave.save();

        res.status(200).json({ message: 'Leave cancelled', leave });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Update Leave ─────────────────────────────────────────────────────────────
export const updateLeave = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
        if (!leave) return res.status(404).json({ message: 'Leave not found' });
        if (leave.status !== 'pending')
            return res.status(400).json({ message: 'Only pending leaves can be edited' });

        const { type, startDate, endDate, reason, isHourly, startTime, endTime } = req.body;

        if (isHourly) {
            if (!startTime || !endTime)
                return res.status(400).json({ message: 'startTime and endTime are required for hourly leave.' });
            if (toMins(startTime) >= toMins(endTime))
                return res.status(400).json({ message: 'startTime must be before endTime.' });
        }

        if (startDate && endDate) {
            const overlap = await Leave.findOne({
                _id:     { $ne: leave._id },
                staffId: staff._id,
                status:  { $in: ['pending', 'approved'] },
                startDate: { $lte: new Date(endDate) },
                endDate:   { $gte: new Date(startDate) },
            });
            if (overlap)
                return res.status(400).json({ message: 'Another leave already overlaps these dates.' });

            const conflicting = await getConflictingBookings(staff._id, startDate, endDate, isHourly, startTime, endTime);
            if (conflicting.length > 0) {
                return res.status(400).json({
                    message: `You have ${conflicting.length} booking(s) that conflict with these leave dates.`,
                    conflictingBookings: groupByDay(conflicting),
                });
            }
        }

        if (type)      leave.type      = type;
        if (startDate) leave.startDate = new Date(startDate);
        if (endDate)   leave.endDate   = new Date(isHourly ? startDate : endDate);
        if (reason !== undefined) leave.reason = reason;

        leave.isHourly  = !!isHourly;
        leave.startTime = isHourly ? startTime : undefined;
        leave.endTime   = isHourly ? endTime   : undefined;

        await leave.save();
        res.status(200).json({ message: 'Leave updated', leave });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Delete Leave ─────────────────────────────────────────────────────────────
export const deleteLeave = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
        if (!leave) return res.status(404).json({ message: 'Leave not found' });

        if (leave.status === 'pending')
            return res.status(400).json({ message: 'Cancel the leave request before deleting.' });
        if (leave.status === 'approved' || leave.status === 'rejected')
            return res.status(400).json({ message: 'Approved or rejected leaves cannot be deleted.' });

        await leave.deleteOne();
        res.status(200).json({ message: 'Leave deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Get All Leaves (Admin) ───────────────────────────────────────────────────
export const getAllLeaves = async (req, res) => {
    try {
        const filter = req.query.status ? { status: req.query.status } : {};
        const leaves = await Leave.find(filter)
            .populate({ path: 'staffId', populate: { path: 'userId', select: 'firstName lastName email profileImage' } })
            .sort({ createdAt: -1 });
        res.status(200).json(leaves);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Review Leave (Admin) ─────────────────────────────────────────────────────
export const reviewLeave = async (req, res) => {
    try {
        const { status, adminNote } = req.body;
        if (!['approved', 'rejected'].includes(status))
            return res.status(400).json({ message: 'Status must be approved or rejected' });

        const leave = await Leave.findById(req.params.id).populate({
            path: 'staffId',
            populate: { path: 'userId', select: 'firstName lastName email profileImage' },
        });
        if (!leave) return res.status(404).json({ message: 'Leave not found' });

        if (leave.status === 'cancelled')
            return res.status(400).json({ message: 'Cannot change a cancelled leave.' });
        if (leave.status !== 'pending' && !adminNote?.trim())
            return res.status(400).json({ message: 'A reason is required when changing an already-reviewed leave.' });

        const previousStatus = leave.status;

        leave.status     = status;
        leave.adminNote  = adminNote || '';
        leave.reviewedBy = req.user.id;
        leave.reviewedAt = new Date();
        await leave.save();

        // ── Update staff leave status ─────────────────────────────────────────
        if (!leave.isHourly) {
            if (status === 'approved') {
                await Staff.findByIdAndUpdate(leave.staffId._id, {
                    isOnLeave: true,
                    currentLeave: {
                        startDate: leave.startDate,
                        endDate:   leave.endDate,
                        type:      leave.type,
                        reason:    leave.reason,
                    },
                });
            } else if (status === 'rejected' && previousStatus === 'approved') {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const otherActive = await Leave.findOne({
                    staffId:   leave.staffId._id,
                    _id:       { $ne: leave._id },
                    status:    'approved',
                    isHourly:  { $ne: true },
                    startDate: { $lte: today },
                    endDate:   { $gte: today },
                });
                if (!otherActive) {
                    await Staff.findByIdAndUpdate(leave.staffId._id, {
                        isOnLeave:    false,
                        currentLeave: null,
                    });
                }
            }
        }

        // ── Send status email ─────────────────────────────────────────────────
        const { firstName, lastName, email } = leave.staffId.userId;
        try {
            await sendMail(
                email,
                leaveStatusTemplate(
                    `${firstName} ${lastName}`,
                    leave.type,
                    leave.startDate,
                    leave.endDate,
                    status,
                    adminNote,
                    leave.isHourly,
                    leave.startTime,
                    leave.endTime,
                ),
            );
        } catch (e) {
            console.error('Email error:', e.message);
        }

        await writeAuditLog({
            user: req.user,
            entity: 'leave',
            entityId: leave._id,
            action: `leave.${status}`,
            description: `Leave ${status} for ${firstName} ${lastName} (${leave.type}, ${new Date(leave.startDate).toLocaleDateString()})${adminNote ? ` — Note: ${adminNote}` : ''}`,
            before: { status: previousStatus },
            after:  { status, adminNote },
            meta:   { staffName: `${firstName} ${lastName}`, leaveType: leave.type },
            req,
        });

        res.status(200).json({ message: `Leave ${status}`, leave });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


