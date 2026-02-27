import Leave from '../models/leave.js';
import nodemailer from 'nodemailer';
import config from '../config/index.js';


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});


const sendLeaveStatusEmail = async (leave, status, adminReason = '') => {
  const isApproved = status === 'approved';
  const statusColor = isApproved ? '#22B8C8' : '#B62025';
  const statusTitle = isApproved ? 'Leave Approved' : 'Leave Rejected';

  const mailOptions = {
    to: leave.staffMember.email,
    subject: `Leave Request Update - ${status.toUpperCase()}`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: auto; padding: 30px; background-color: #F5EDE4; border-radius: 20px; border: 1px solid #e0d5c8;">
        <h2 style="color: ${statusColor}; margin-bottom: 10px; text-align: center;">${statusTitle}</h2>
        
        <div style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <p style="color: #444; font-size: 16px;">Hi <strong>${leave.staffMember.firstName}</strong>,</p>
          <p style="color: #555; font-size: 15px;">Your leave request has been <strong>${status}</strong>:</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
             <p style="margin: 5px 0; color: #666;"><strong>Dates:</strong> ${new Date(leave.startDate).toDateString()} - ${new Date(leave.endDate).toDateString()}</p>
             <p style="margin: 5px 0; color: #666;"><strong>Type:</strong> ${leave.type}</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; background: ${statusColor}; color: white; padding: 12px 30px; border-radius: 10px; font-weight: bold; text-transform: uppercase;">
              ${status}
            </span>
          </div>

          ${adminReason ? `
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 5px solid ${statusColor};">
              <p style="margin: 0; font-size: 14px; color: #856404;"><strong>Admin Feedback:</strong></p>
              <p style="margin: 5px 0 0 0; color: #666; font-style: italic;">"${adminReason}"</p>
            </div>
          ` : ''}
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 25px; text-align: center;">&copy; 2026 Lough Skin Portal</p>
      </div>`
  };
  return transporter.sendMail(mailOptions);
};


export const requestLeave = async (req, res) => {
  try {
    const { startDate, endDate, type, reason } = req.body;
    const leave = await Leave.create({
      staffMember: req.user._id,
      startDate,
      endDate,
      type,
      reason,
      status: 'pending'
    });
    res.status(201).json({ success: true, data: leave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const approveLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).populate('staffMember', 'firstName email');
    if (!leave) return res.status(404).json({ message: "Leave record not found" });

    leave.status = 'approved';
    leave.approvedBy = req.user._id;
    await leave.save(); // Triggers middleware and updates timestamps correctly

    await sendLeaveStatusEmail(leave, 'approved');
    res.status(200).json({ success: true, message: "Leave approved and email sent" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const rejectLeave = async (req, res) => {
  const { adminReason } = req.body;
  try {
    const leave = await Leave.findById(req.params.id).populate('staffMember', 'firstName email');
    if (!leave) return res.status(404).json({ message: "Leave record not found" });

    leave.status = 'rejected';
    leave.approvedBy = req.user._id;
    await leave.save();

    await sendLeaveStatusEmail(leave, 'rejected', adminReason);
    res.status(200).json({ success: true, message: "Leave rejected and email sent" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const cancelLeave = async (req, res) => {
  try {
    const leave = await Leave.findOne({ _id: req.params.id, staffMember: req.user._id });
    if (!leave) return res.status(404).json({ message: "Leave not found" });
    if (leave.status !== 'pending') return res.status(400).json({ message: "Cannot cancel processed leave" });

    await leave.deleteOne();
    res.status(200).json({ message: "Leave cancelled successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const getMyLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find({ staffMember: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const getAllLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find().populate('staffMember', 'firstName lastName role').sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};