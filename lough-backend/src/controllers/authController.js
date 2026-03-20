// controllers/adminAuthController.js
import User from '../models/user.js';
import Staff from '../models/staff.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';
import { sendMail } from '../utils/mailer.js';
import { inviteUserTemplate, adminResetPasswordTemplate } from '../utils/adminEmailTemplates.js';
import { writeAuditLog } from '../utils/auditLogger.js';

// ─── Helper: generate token + expiry ─────────────────────────────────────────
const generateVerifyToken = () => ({
    token: crypto.randomBytes(32).toString('hex'),
    expires: Date.now() + 5 * 60 * 1000,
});


// ─── Invite User ──────────────────────────────────────────────────────────────
export const inviteUser = async (req, res) => {
    const { firstName, lastName, email, phone, gender, role, adminKey } = req.body;

    try {
        if (adminKey !== config.adminSecretKey) {
            return res.status(401).json({ message: 'Incorrect Admin Secret Key!' });
        }

        const userExists = await User.findOne({ email });
        if (userExists && userExists.isActive) {
            return res.status(400).json({ message: 'User already exists!' });
        }
        await User.deleteOne({ email, isActive: false });

        const { token, expires } = generateVerifyToken();

        const newUser = new User({
            firstName, lastName, email, phone, gender, role,
            emailVerifyToken: token,
            emailVerifyTokenExpire: expires,
            password: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
            isActive: false,
        });
        await newUser.save();

        const link = `${config.clientUrl}/setup-password?token=${token}&email=${email}`;
        await sendMail(email, inviteUserTemplate(firstName, role, link));

        await writeAuditLog({
            user: req.user || null,
            entity: 'auth',
            entityId: newUser._id,
            action: 'auth.user_invited',
            description: `Invited ${role} user: ${firstName} ${lastName} (${email})`,
            meta: { email, role },
            req,
        });

        res.status(200).json({ message: 'Invite link sent!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Verify & Setup Password ──────────────────────────────────────────────────
export const verifyAndSetup = async (req, res) => {
    const { token, email, password } = req.body;
    try {
        const user = await User.findOne({
            email,
            emailVerifyToken: token,
            emailVerifyTokenExpire: { $gt: Date.now() },
            isActive: false,
        });

        if (!user) return res.status(400).json({ message: 'Link expired or invalid!' });

        user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
        user.isActive = true;
        user.emailVerifyToken = undefined;
        user.emailVerifyTokenExpire = undefined;
        await user.save();

        if (user.role === 'staff') {
            await Staff.findOneAndUpdate(
                { userId: user._id },
                { verifiedEmail: user.email },
                { returnDocument: 'after' }
            );
        }

        res.status(200).json({ message: 'Verified! You can login now.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Verify Token Status ──────────────────────────────────────────────────────
export const verifyTokenStatus = async (req, res) => {
    const { token, email } = req.body;
    try {
        const user = await User.findOne({
            email,
            emailVerifyToken: token,
            emailVerifyTokenExpire: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ isValid: false, message: 'Link is invalid or has expired!' });
        }

        res.status(200).json({ isValid: true, message: 'Token is valid.' });
    } catch (err) {
        res.status(500).json({ isValid: false, message: err.message });
    }
};


// ─── Login ────────────────────────────────────────────────────────────────────
export const loginUser = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email, isActive: true });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid credentials or account not active!' });
        }

        if (user.role === 'staff') {
            const staff = await Staff.findOne({ userId: user._id });
            if (!staff || !staff.verifiedEmail) {
                const isPendingChange = staff?.pendingEmail;
                return res.status(403).json({
                    message: isPendingChange
                        ? `Your email address has been changed. Please verify your new email (${staff.pendingEmail}) to log in.`
                        : 'Staff email not verified. Please verify your email to login.',
                });
            }
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/api/auth/refresh',
        });

        user.lastLogin = Date.now();
        await user.save();

        await writeAuditLog({
            user: { id: user._id, name: `${user.firstName} ${user.lastName}`, role: user.role },
            entity: 'auth',
            entityId: user._id,
            action: 'auth.login',
            description: `${user.role} logged in: ${user.email}`,
            meta: { email: user.email },
            req,
        });

        res.status(200).json({
            accessToken,
            user: {
                name: `${user.firstName} ${user.lastName}`,
                role: user.role,
                profileImage: user.profileImage || null,
            },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Refresh Token ────────────────────────────────────────────────────────────
export const refreshToken = async (req, res) => {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    try {
        const decoded = jwt.verify(token, config.jwt.refreshSecret);
        const user = await User.findOne({ _id: decoded.id, isActive: true });
        if (!user) return res.status(403).json({ message: 'User not found' });

        res.status(200).json({
            accessToken: generateAccessToken(user),
            user: {
                name: `${user.firstName} ${user.lastName}`,
                role: user.role,
                profileImage: user.profileImage || null,
            },
        });
    } catch (err) {
        return res.status(403).json({ message: 'Invalid refresh token' });
    }
};


// ─── Logout ───────────────────────────────────────────────────────────────────
export const logoutUser = async (req, res) => {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth/refresh',
    });
    res.status(200).json({ message: 'Logged out successfully' });
};


// ─── Forgot Password ──────────────────────────────────────────────────────────
export const resetPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email, isActive: true });
        if (!user) return res.status(400).json({ message: 'User not found or inactive!' });

        const { token, expires } = generateVerifyToken();
        user.emailVerifyToken = token;
        user.emailVerifyTokenExpire = expires;
        await user.save();

        const link = `${config.clientUrl}/reset-password?token=${token}&email=${email}`;
        await sendMail(email, adminResetPasswordTemplate(link));

        res.status(200).json({ message: 'Password reset link sent!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Reset Password Confirm ───────────────────────────────────────────────────
export const resetPasswordConfirm = async (req, res) => {
    const { token, email, newPassword } = req.body;
    try {
        const user = await User.findOne({
            email,
            emailVerifyToken: token,
            emailVerifyTokenExpire: { $gt: Date.now() },
            isActive: true,
        });

        if (!user) return res.status(400).json({ message: 'Invalid or expired token!' });

        user.password = await bcrypt.hash(newPassword, 10);
        user.emailVerifyToken = undefined;
        user.emailVerifyTokenExpire = undefined;
        await user.save();

        res.status(200).json({ message: 'Password reset successfully!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};