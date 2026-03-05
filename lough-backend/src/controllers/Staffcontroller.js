import Staff from '../models/staff.js';
import User from '../models/user.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import Leave from '../models/leave.js';
const sendInviteEmail = async (email, token) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
       user: config.email.user,
       pass: config.email.pass
     },
  });

  const link = `${config.clientUrl}/setup-password?token=${token}&email=${email}`;

  await transporter.sendMail({
    to: email,
    subject: 'You have been invited to Lough Skin',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#F5EDE4;border-radius:16px">
        <h2 style="color:#22B8C8;margin-bottom:8px">Welcome to Lough Skin!</h2>
        <p style="color:#555;margin-bottom:24px">You've been invited as a staff member. Click the button below to set your password and activate your account.</p>
        <a href="${link}" style="display:inline-block;background:#22B8C8;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold">Set Up My Account</a>
        <p style="color:#aaa;font-size:12px;margin-top:24px">This link expires in 5 minutes. If you did not expect this, ignore this email.</p>
      </div>
    `,
  });
};


export const getAllStaff = async (req, res) => {
  try {
    const staff = await Staff.find()
      .populate('userId', 'firstName lastName email phone gender role isActive lastLogin createdAt profileImage')
      .populate('skills', 'name price duration')
      .sort({ createdAt: -1 });
   
    res.status(200).json(staff);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching staff', error: err.message });
  }
};





export const createStaff = async (req, res) => {
  try {
    const {

      firstName, lastName, email, phone, gender,
   
      skills, genderRestriction, bio, specializations, workingHours,
    } = req.body;

   
    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser.isActive) {
      return res.status(400).json({ message: 'A user with this email already exists!' });
    }
   
    if (existingUser && !existingUser.isActive) {
      await User.deleteOne({ _id: existingUser._id });
      await Staff.deleteOne({ userId: existingUser._id });
    }

    
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000; // 5 min


    const tempPassword = await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10);
    const newUser = new User({
      firstName,
      lastName,
      email,
      phone,
      gender,
      role: 'staff',
      password: tempPassword,
      isActive: false,
      emailVerifyToken: token,
      emailVerifyTokenExpire: expires,
    });
    await newUser.save();

   
    const newStaff = new Staff({
      userId: newUser._id,
      skills: skills || [],
      genderRestriction: genderRestriction || 'all',
      bio: bio || '',
      specializations: specializations || [],
      workingHours: workingHours || {},
    });
    await newStaff.save();

 
    await sendInviteEmail(email, token);

   
    const populated = await Staff.findById(newStaff._id)
      .populate('userId', 'firstName lastName email phone gender role isActive lastLogin')
      .populate('skills', 'name price duration');

    res.status(201).json({ message: 'Staff created & invite sent!', staff: populated });
  } catch (err) {
    res.status(400).json({ message: 'Error creating staff', error: err.message });
  }
};


export const updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName, lastName, phone, gender,
      skills, genderRestriction, bio, specializations, isOnLeave, workingHours, currentLeave,
    } = req.body;


    const staff = await Staff.findById(id);
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    await User.findByIdAndUpdate(staff.userId, {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phone !== undefined && { phone }),
      ...(gender && { gender }),
    });

  
    const updated = await Staff.findByIdAndUpdate(
      id,
      { skills, genderRestriction, bio, specializations, isOnLeave, workingHours, currentLeave },
      { new: true, runValidators: true }
    )
      .populate('userId', 'firstName lastName email phone gender role isActive lastLogin')
      .populate('skills', 'name price duration');

    res.status(200).json(updated);
  } catch (err) {
    res.status(400).json({ message: 'Error updating staff', error: err.message });
  }
};


export const toggleStaffActive = async (req, res) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findById(id).populate('userId');
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const user = await User.findById(staff.userId._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isActive = !user.isActive;
    await user.save();

    const updated = await Staff.findById(id)
      .populate('userId', 'firstName lastName email phone gender role isActive lastLogin profileImage')
      .populate('skills', 'name price duration');

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Error toggling status', error: err.message });
  }
};


export const resendInvite = async (req, res) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findById(id).populate('userId');
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const user = await User.findById(staff.userId._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.isActive) {
      return res.status(400).json({ message: 'User is already active — no invite needed' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerifyToken = token;
    user.emailVerifyTokenExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    await sendInviteEmail(user.email, token);

    res.status(200).json({ message: 'Invite resent!' });
  } catch (err) {
    res.status(500).json({ message: 'Error resending invite', error: err.message });
  }
};


export const deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findById(id);
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    // Delete user account too
    await User.findByIdAndDelete(staff.userId);
    await Staff.findByIdAndDelete(id);
   await Leave.deleteMany({ staffId: id });
    res.status(200).json({ message: 'Staff and user account deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting staff', error: err.message });
  }
};


export const getGoogleCalenderStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const staff = await Staff.findOne({ userId });

    if (!staff) {
      return res.status(404).json(false);
    }

    const isConnected =
      !!staff.googleCalendarId &&
      staff.googleCalendarSyncStatus?.status === 'connected';
    
    return res.status(200).json(isConnected);

  } catch (error) {
    console.error('Google Calendar Status Error:', error);
    return res.status(500).json(false);
  }
};