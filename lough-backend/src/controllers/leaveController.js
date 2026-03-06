import Leave from '../models/leave.js';
import Staff from '../models/staff.js';
import User  from '../models/user.js';
import Booking from '../models/bookingModel.js';
import nodemailer from 'nodemailer';
import config from '../config/index.js';


// ─── Email Helper ────────────────────────────────────────────────────────────
const sendStatusEmail = async (to, name, type, start, end, status, note) => {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.user, pass: config.email.pass },
  });
  const color = status === 'approved' ? '#22B8C8' : '#ef4444';
  const emoji = status === 'approved' ? '✅' : '❌';
  const title = `Leave ${status.charAt(0).toUpperCase() + status.slice(1)} ${emoji}`;

  await transport.sendMail({
    to,
    subject: `Your Leave Request has been ${status} - Lough Skin`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;
                  background:#F5EDE4;border-radius:16px">
        <h2 style="color:${color};margin-bottom:8px">${title}</h2>
        <p style="color:#555">Hi <strong>${name}</strong>,</p>
        <p style="color:#555">Your leave request has been <strong>${status}</strong>.</p>
        <div style="background:#fff;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:4px 0"><strong>Type:</strong> ${type.charAt(0).toUpperCase()+type.slice(1)}</p>
          <p style="margin:4px 0"><strong>From:</strong> ${new Date(start).toDateString()}</p>
          <p style="margin:4px 0"><strong>To:</strong>   ${new Date(end).toDateString()}</p>
          ${note ? `<p style="margin:8px 0 0;color:#555"><strong>Admin Note:</strong> ${note}</p>` : ''}
        </div>
        <p style="color:#aaa;font-size:12px">Lough Skin Staff Portal</p>
      </div>`,
  });
};


// ─── STAFF: Apply Leave ──────────────────────────────────────────────────────
export const applyLeave = async (req, res) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

    // 1. Check overlapping leave requests
    const overlap = await Leave.findOne({
      staffId: staff._id,
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: new Date(endDate) },
      endDate:   { $gte: new Date(startDate) },
    });
    if (overlap) return res.status(400).json({ message: 'You already have a leave overlapping these dates.' });

    // 2. Check existing confirmed bookings within the requested leave dates
    const leaveStart = new Date(startDate);
    leaveStart.setHours(0, 0, 0, 0);
    const leaveEnd = new Date(endDate);
    leaveEnd.setHours(23, 59, 59, 999);

    const conflictingBooking = await Booking.findOne({
      staffMember: staff._id,
      bookingDate: { $gte: leaveStart, $lte: leaveEnd },
      status: { $in: ['pending', 'confirmed'] },
    }).populate('service', 'name');

    if (conflictingBooking) {
      const conflictDate = new Date(conflictingBooking.bookingDate).toDateString();
      return res.status(400).json({
        message: `You have an existing booking on ${conflictDate} at ${conflictingBooking.bookingTime} (${conflictingBooking.service?.name || 'service'}). Please resolve it before applying for leave on these dates.`,
        conflictingBooking: {
          bookingNumber: conflictingBooking.bookingNumber,
          date: conflictDate,
          time: conflictingBooking.bookingTime,
          service: conflictingBooking.service?.name,
        },
      });
    }

    // 3. All clear — create leave
    const leave = await Leave.create({
      staffId: staff._id, type,
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      reason,
    });

    const populated = await Leave.findById(leave._id).populate({
      path: 'staffId',
      populate: { path: 'userId', select: 'firstName lastName email' },
    });

    res.status(201).json({ message: 'Leave request submitted!', leave: populated });
  } catch (err) {
    res.status(400).json({ message: 'Error applying leave', error: err.message });
  }
};


// ─── STAFF: Get My Leaves ────────────────────────────────────────────────────
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


// ─── STAFF: Cancel Pending Leave ─────────────────────────────────────────────
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


// ─── STAFF: Edit Pending Leave ───────────────────────────────────────────────
export const updateLeave = async (req, res) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
    if (!leave) return res.status(404).json({ message: 'Leave not found' });
    if (leave.status !== 'pending')
      return res.status(400).json({ message: 'Only pending leaves can be edited' });

    const { type, startDate, endDate, reason } = req.body;

    // Check overlap (exclude this leave itself)
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

      // Check bookings conflict for updated dates too
      const leaveStart = new Date(startDate);
      leaveStart.setHours(0, 0, 0, 0);
      const leaveEnd = new Date(endDate);
      leaveEnd.setHours(23, 59, 59, 999);

      const conflictingBooking = await Booking.findOne({
        staffMember: staff._id,
        bookingDate: { $gte: leaveStart, $lte: leaveEnd },
        status: { $in: ['pending', 'confirmed'] },
      }).populate('service', 'name');

      if (conflictingBooking) {
        const conflictDate = new Date(conflictingBooking.bookingDate).toDateString();
        return res.status(400).json({
          message: `You have an existing booking on ${conflictDate} at ${conflictingBooking.bookingTime} (${conflictingBooking.service?.name || 'service'}). Please resolve it before applying for leave on these dates.`,
          conflictingBooking: {
            bookingNumber: conflictingBooking.bookingNumber,
            date: conflictDate,
            time: conflictingBooking.bookingTime,
            service: conflictingBooking.service?.name,
          },
        });
      }
    }

    if (type)      leave.type      = type;
    if (startDate) leave.startDate = new Date(startDate);
    if (endDate)   leave.endDate   = new Date(endDate);
    if (reason !== undefined) leave.reason = reason;

    await leave.save();

    res.status(200).json({ message: 'Leave updated', leave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ─── STAFF: Delete Leave (non-pending / cancelled / rejected) ────────────────
export const deleteLeave = async (req, res) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
    if (!leave) return res.status(404).json({ message: 'Leave not found' });

    // Staff can only delete cancelled leaves
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


// ─── ADMIN: Get All Leaves ───────────────────────────────────────────────────
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


// ─── ADMIN: Review / Toggle Leave Status ─────────────────────────────────────
// Works for:
//   pending  → approved / rejected   (first review)
//   approved → rejected              (toggle with reason)
//   rejected → approved              (toggle with reason)
export const reviewLeave = async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    const leave = await Leave.findById(req.params.id).populate({
      path: 'staffId',
      populate: { path: 'userId', select: 'firstName lastName email' },
    });
    if (!leave) return res.status(404).json({ message: 'Leave not found' });

    // Allow pending → approved/rejected (first review)
    // Allow approved → rejected or rejected → approved (toggle)
    // Block cancelled
    if (leave.status === 'cancelled')
      return res.status(400).json({ message: 'Cannot change a cancelled leave.' });

    // If toggling (already reviewed), reason is required
    if (leave.status !== 'pending' && !adminNote?.trim())
      return res.status(400).json({ message: 'A reason is required when changing an already-reviewed leave.' });

    const previousStatus = leave.status;

    leave.status     = status;
    leave.adminNote  = adminNote || '';
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();
    await leave.save();

    // Update Staff.isOnLeave flag
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
      // Was approved → now rejected → clear isOnLeave
      await Staff.findByIdAndUpdate(leave.staffId._id, {
        isOnLeave:    false,
        currentLeave: null,
      });
    }

    const { firstName, lastName, email } = leave.staffId.userId;

    try {
      await sendStatusEmail(
        email,
        `${firstName} ${lastName}`,
        leave.type,
        leave.startDate,
        leave.endDate,
        status,
        adminNote,
      );
    } catch (e) { console.error('Email error:', e.message); }

    res.status(200).json({ message: `Leave ${status}`, leave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ─── DEV UTIL: Delete All Leaves ─────────────────────────────────────────────
export const deleteAllLeaves = async (req, res) => {
  const result = await Leave.deleteMany({});
  res.status(200).json({ message: `Deleted ${result.deletedCount} leave record(s).`, deletedCount: result.deletedCount });
};