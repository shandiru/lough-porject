import Leave from '../models/leave.js';
import Staff from '../models/staff.js';
import User  from '../models/user.js';
import nodemailer from 'nodemailer';
import config from '../config/index.js';

// ── Email helper ──────────────────────────────────────────────────────────────
const sendStatusEmail = async (to, name, type, start, end, status, note) => {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.user, pass: config.email.pass },
  });
  const color  = status === 'approved' ? '#22B8C8' : '#ef4444';
  const emoji  = status === 'approved' ? '✅' : '❌';
  const title  = `Leave ${status.charAt(0).toUpperCase() + status.slice(1)} ${emoji}`;

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

// ── STAFF: Apply leave ────────────────────────────────────────────────────────
export const applyLeave = async (req, res) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff profile not found' });

    const overlap = await Leave.findOne({
      staffId: staff._id,
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: new Date(endDate) },
      endDate:   { $gte: new Date(startDate) },
    });
    if (overlap) return res.status(400).json({ message: 'You already have a leave overlapping these dates.' });

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

    // Real-time → admin
    req.app.get('io')?.to('admin-room').emit('leave:new', {
      message: `New leave request from ${populated.staffId.userId.firstName} ${populated.staffId.userId.lastName}`,
      leave: populated,
    });

    res.status(201).json({ message: 'Leave request submitted!', leave: populated });
  } catch (err) {
    res.status(400).json({ message: 'Error applying leave', error: err.message });
  }
};

// ── STAFF: Get my leaves ──────────────────────────────────────────────────────
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

// ── STAFF: Cancel pending leave ───────────────────────────────────────────────
export const cancelLeave = async (req, res) => {
  try {
    const staff = await Staff.findOne({ userId: req.user.id });
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const leave = await Leave.findOne({ _id: req.params.id, staffId: staff._id });
    if (!leave) return res.status(404).json({ message: 'Leave not found' });
    if (leave.status !== 'pending') return res.status(400).json({ message: 'Only pending leaves can be cancelled' });

    leave.status = 'cancelled';
    await leave.save();

    const staffUser = await User.findById(staff.userId);
    req.app.get('io')?.to('admin-room').emit('leave:cancelled', {
      message: `${staffUser.firstName} ${staffUser.lastName} cancelled their leave request.`,
      leaveId: req.params.id,
    });

    res.status(200).json({ message: 'Leave cancelled', leave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ADMIN: Get all leaves ─────────────────────────────────────────────────────
export const getAllLeaves = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const leaves = await Leave.find(filter)
      .populate({ path: 'staffId', populate: { path: 'userId', select: 'firstName lastName email' } })
      .sort({ createdAt: -1 });
    res.status(200).json(leaves);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ADMIN: Approve / Reject ───────────────────────────────────────────────────
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
    if (leave.status !== 'pending') return res.status(400).json({ message: 'Only pending leaves can be reviewed' });

    leave.status     = status;
    leave.adminNote  = adminNote || '';
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();
    await leave.save();

    // If approved → update staff isOnLeave
    if (status === 'approved') {
      await Staff.findByIdAndUpdate(leave.staffId._id, {
        isOnLeave: true,
        currentLeave: { startDate: leave.startDate, endDate: leave.endDate, type: leave.type, reason: leave.reason },
      });
    }

    const { firstName, lastName, email } = leave.staffId.userId;

    // Send email
    try {
      await sendStatusEmail(email, `${firstName} ${lastName}`, leave.type, leave.startDate, leave.endDate, status, adminNote);
    } catch (e) { console.error('Email error:', e.message); }

    // Real-time → staff
    req.app.get('io')?.to(`staff-${leave.staffId._id}`).emit('leave:reviewed', {
      message: `Your leave request has been ${status}.`,
      status, leaveId: req.params.id, adminNote,
    });

    res.status(200).json({ message: `Leave ${status}`, leave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};