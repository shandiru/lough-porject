// controllers/staffController.js
import Staff   from '../models/staff.js';
import User    from '../models/user.js';
import crypto  from 'crypto';
import bcrypt  from 'bcryptjs';
import config  from '../config/index.js';
import Leave   from '../models/leave.js';
import Booking from '../models/bookingModel.js';
import { sendMail } from '../utils/mailer.js';                                      // ✅ Singleton
import {
    staffInviteTemplate,
    emailChangeVerificationTemplate,
} from '../utils/adminEmailTemplates.js';                                            // ✅ Templates

// ─── Helper: generate token + expiry ─────────────────────────────────────────
const generateToken = (expiresInMs = 5 * 60 * 1000) => ({
    token:   crypto.randomBytes(32).toString('hex'),
    expires: Date.now() + expiresInMs,
});


// ─── GET /api/staff ───────────────────────────────────────────────────────────
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


// ─── POST /api/staff ──────────────────────────────────────────────────────────
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

        const { token, expires } = generateToken(5 * 60 * 1000);

        const newUser = new User({
            firstName, lastName, email, phone, gender,
            role:     'staff',
            password: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
            isActive: false,
            emailVerifyToken:       token,
            emailVerifyTokenExpire: expires,
        });
        await newUser.save();

        const newStaff = new Staff({
            userId:            newUser._id,
            skills:            skills            || [],
            genderRestriction: genderRestriction || 'all',
            bio:               bio               || '',
            specializations:   specializations   || [],
            workingHours:      workingHours      || {},
        });
        await newStaff.save();

        const link = `${config.clientUrl}/setup-password?token=${token}&email=${email}`;
        await sendMail(email, staffInviteTemplate(link));                            // ✅ Clean

        const populated = await Staff.findById(newStaff._id)
            .populate('userId', 'firstName lastName email phone gender role isActive lastLogin')
            .populate('skills', 'name price duration');

        res.status(201).json({ message: 'Staff created & invite sent!', staff: populated });
    } catch (err) {
        res.status(400).json({ message: 'Error creating staff', error: err.message });
    }
};


// ─── PUT /api/staff/:id ───────────────────────────────────────────────────────
export const updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstName, lastName, phone, gender, email,
            skills, genderRestriction, bio, specializations,
            isOnLeave, workingHours, currentLeave,
        } = req.body;

        const staff = await Staff.findById(id).populate('userId');
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const user = await User.findById(staff.userId._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        let emailChangeInitiated = false;

        if (email && email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
            const emailTaken = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
            if (emailTaken) {
                return res.status(400).json({ message: 'This email is already in use by another account.' });
            }

            user.isActive = false;

            const { token, expires } = generateToken(24 * 60 * 60 * 1000);           // 24h

            staff.pendingEmail          = email.toLowerCase().trim();
            staff.emailChangeToken      = token;
            staff.emailChangeTokenExpire = new Date(expires);
            staff.verifiedEmail         = null;
            staff.googleCalendarToken   = undefined;
            staff.googleCalendarId      = undefined;
            staff.googleCalendarSyncStatus = {
                lastSync:     new Date(),
                status:       'disconnected',
                errorMessage: 'Disconnected automatically due to email change.',
            };
            await staff.save();

            user.email = email.toLowerCase().trim();
            await user.save();

            const link = `${config.clientUrl}/verify-email-change?token=${token}&email=${encodeURIComponent(email)}`;
            await sendMail(email, emailChangeVerificationTemplate(user.firstName, link)); // ✅ Clean

            emailChangeInitiated = true;
        } else {
            await user.save();
        }

        await User.findByIdAndUpdate(user._id, {
            ...(firstName            && { firstName }),
            ...(lastName             && { lastName }),
            ...(phone !== undefined  && { phone }),
            ...(gender               && { gender }),
        });

        const updated = await Staff.findByIdAndUpdate(
            id,
            { skills, genderRestriction, bio, specializations, isOnLeave, workingHours, currentLeave },
            { returnDocument: 'after', runValidators: true },
        )
            .populate('userId', 'firstName lastName email phone gender role isActive lastLogin')
            .populate('skills', 'name price duration');

        res.status(200).json({
            ...updated.toObject(),
            emailChangeInitiated,
            message: emailChangeInitiated
                ? 'Staff updated. A verification email has been sent to the new address. Staff login is blocked until verified.'
                : 'Staff updated successfully.',
        });
    } catch (err) {
        res.status(400).json({ message: 'Error updating staff', error: err.message });
    }
};


// ─── PATCH /api/staff/:id/toggle-active ──────────────────────────────────────
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


// ─── POST /api/staff/:id/resend-invite ───────────────────────────────────────
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

        const { token, expires } = generateToken(24 * 60 * 60 * 1000);              // 24h

        // Case 1: Email change pending — resend verify-email-change link
        if (staff.pendingEmail) {
            staff.emailChangeToken       = token;
            staff.emailChangeTokenExpire = new Date(expires);
            await staff.save();

            const link = `${config.clientUrl}/verify-email-change?token=${token}&email=${encodeURIComponent(staff.pendingEmail)}`;
            await sendMail(staff.pendingEmail, emailChangeVerificationTemplate(user.firstName, link)); // ✅ Clean

            return res.status(200).json({ message: 'Email change verification link resent!' });
        }

        // Case 2: New staff — resend setup-password invite link
        user.emailVerifyToken       = token;
        user.emailVerifyTokenExpire = expires;
        await user.save();

        const link = `${config.clientUrl}/setup-password?token=${token}&email=${user.email}`;
        await sendMail(user.email, staffInviteTemplate(link));                       // ✅ Clean

        res.status(200).json({ message: 'Setup invite resent!' });
    } catch (err) {
        res.status(500).json({ message: 'Error resending invite', error: err.message });
    }
};


// ─── DELETE /api/staff/:id ────────────────────────────────────────────────────
export const deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;

        const staff = await Staff.findById(id);
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const activeBookings = await Booking.findOne({
            staffMember: id,
            status: { $in: ['pending', 'confirmed'] },
        });
        if (activeBookings) {
            return res.status(400).json({ message: 'Cannot delete staff: This staff member has active bookings.' });
        }

        await User.findByIdAndDelete(staff.userId);
        await Staff.findByIdAndDelete(id);
        await Leave.deleteMany({ staffId: id });

        res.status(200).json({ message: 'Staff and user account deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting staff', error: err.message });
    }
};


// ─── GET /api/staff/google-calendar-status ────────────────────────────────────
export const getGoogleCalenderStatus = async (req, res) => {
    try {
        const staff = await Staff.findOne({ userId: req.user.id });
        if (!staff) return res.status(404).json(false);

        const isConnected =
            !!staff.googleCalendarId &&
            staff.googleCalendarSyncStatus?.status === 'connected';

        return res.status(200).json(isConnected);
    } catch (error) {
        console.error('Google Calendar Status Error:', error);
        return res.status(500).json(false);
    }
};


// ─── POST /api/staff/verify-email-change ─────────────────────────────────────
export const verifyEmailChange = async (req, res) => {
    try {
        const { token, email } = req.body;

        const staff = await Staff.findOne({
            pendingEmail:            email.toLowerCase().trim(),
            emailChangeToken:        token,
            emailChangeTokenExpire:  { $gt: Date.now() },
        }).populate('userId');

        if (!staff) {
            return res.status(400).json({ message: 'Verification link is invalid or has expired.' });
        }

        const user = await User.findById(staff.userId._id);
        if (!user) return res.status(404).json({ message: 'Staff user not found.' });

        user.isActive = true;
        user.email    = staff.pendingEmail;
        await user.save();

        staff.verifiedEmail          = staff.pendingEmail;
        staff.pendingEmail           = null;
        staff.emailChangeToken       = null;
        staff.emailChangeTokenExpire = null;
        await staff.save();

        res.status(200).json({ message: 'Email verified successfully! You can now log in with your new email.' });
    } catch (err) {
        res.status(500).json({ message: 'Error verifying email change', error: err.message });
    }
};