import Staff from '../models/staff.js';
import User from '../models/user.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import Leave from '../models/leave.js';
import Booking from '../models/bookingModel.js';
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


const sendEmailChangeVerification = async (newEmail, token, firstName) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email.user,
      pass: config.email.pass
    },
  });

  const link = `${config.clientUrl}/verify-email-change?token=${token}&email=${encodeURIComponent(newEmail)}`;

  await transporter.sendMail({
    to: newEmail,
    subject: 'Verify Your New Email – Lough Skin',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:32px;background:#F5EDE4;border-radius:20px;border:1px solid #e0d5c8;">
        <h2 style="color:#22B8C8;text-align:center;margin-bottom:8px;">Lough Skin</h2>
        <div style="background:white;padding:25px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
          <p style="color:#444;font-size:16px;">Hi <strong>${firstName}</strong>,</p>
          <p style="color:#555;font-size:15px;line-height:1.6;">
            Your email address on your Lough Skin staff account has been updated.<br/>
            Please verify your new email address to continue accessing your account.
          </p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${link}" style="display:inline-block;background:#22B8C8;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">
              Verify New Email
            </a>
          </div>
          <div style="background:#fff3cd;padding:12px;border-radius:6px;text-align:center;">
            <p style="color:#856404;font-size:13px;margin:0;">
              <strong>Note:</strong> This link expires in <strong>24 hours</strong>. Until verified, you will not be able to log in.
            </p>
          </div>
        </div>
        <p style="color:#999;font-size:12px;margin-top:20px;text-align:center;">
          If you did not expect this change, contact your administrator immediately.<br/>
          &copy; 2026 Lough Skin. All rights reserved.
        </p>
      </div>
    `,
  });
};

export const updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName, lastName, phone, gender, email,
      skills, genderRestriction, bio, specializations, isOnLeave, workingHours, currentLeave
    } = req.body;

    const staff = await Staff.findById(id).populate('userId');
    if (!staff) return res.status(404).json({ message: 'Staff not found' });

    const user = await User.findById(staff.userId._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
     user.isActive = false;
     await user.save();
    // Handle email change
    let emailChangeInitiated = false;
    if (email && email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
      // Check if new email is already taken by another active user
      const emailTaken = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
      if (emailTaken) {
        return res.status(400).json({ message: 'This email is already in use by another account.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store pending email on Staff, clear verifiedEmail so login is blocked
      staff.pendingEmail = email.toLowerCase().trim();
      staff.emailChangeToken = token;
      staff.emailChangeTokenExpire = expires;
      staff.verifiedEmail = null;

      staff.googleCalendarToken = undefined;
      staff.googleCalendarId = undefined;
      staff.googleCalendarSyncStatus = {
        lastSync: new Date(),
        status: 'disconnected',
        errorMessage: 'Disconnected automatically due to email change.',
      };

      await staff.save();
       user.email = email.toLowerCase().trim();
       await user.save();
      await sendEmailChangeVerification(email, token, user.firstName);
      emailChangeInitiated = true;
    }

    // Update user personal info (not email — email only changes after verification)
    await User.findByIdAndUpdate(user._id, {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phone !== undefined && { phone }),
      ...(gender && { gender }),
    });

    const updated = await Staff.findByIdAndUpdate(
      id,
      { skills, genderRestriction, bio, specializations, isOnLeave, workingHours, currentLeave },
      { returnDocument: 'after', runValidators: true }
    )
      .populate('userId', 'firstName lastName email phone gender role isActive lastLogin')
      .populate('skills', 'name price duration');

    res.status(200).json({
      ...updated.toObject(),
      emailChangeInitiated,
      message: emailChangeInitiated
        ? 'Staff updated. A verification email has been sent to the new address. Staff login is blocked until verified.'
        : 'Staff updated successfully.'
    });
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

   
    const activeBookings = await Booking.findOne({ 
      staffMember: id, 
      status: { $in: ['pending', 'confirmed'] } 
    });

    if (activeBookings) {
      return res.status(400).json({ 
        message: 'Cannot delete staff: This staff member has active bookings.' 
      });
    }

   
    await User.findByIdAndDelete(staff.userId);
    await Staff.findByIdAndDelete(id);
    await Leave.deleteMany({ staffId: id });

    res.status(200).json({ message: 'Staff and user account deleted successfully' });
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

export const verifyEmailChange = async (req, res) => {
  try {
    const { token, email } = req.body;

    const staff = await Staff.findOne({
      pendingEmail: email.toLowerCase().trim(),
      emailChangeToken: token,
      emailChangeTokenExpire: { $gt: Date.now() },
    }).populate('userId');

    if (!staff) {
      return res.status(400).json({ message: 'Verification link is invalid or has expired.' });
    }

    const user = await User.findById(staff.userId._id);
    if (!user) return res.status(404).json({ message: 'Staff user not found.' });
      user.isActive = true;
    // Apply the new email to User
    user.email = staff.pendingEmail;
    await user.save();

    // Mark verified, clear pending fields
    staff.verifiedEmail = staff.pendingEmail;
    staff.pendingEmail = null;
    staff.emailChangeToken = null;
    staff.emailChangeTokenExpire = null;
    await staff.save();

    res.status(200).json({ message: 'Email verified successfully! You can now log in with your new email.' });
  } catch (err) {
    res.status(500).json({ message: 'Error verifying email change', error: err.message });
  }
};
