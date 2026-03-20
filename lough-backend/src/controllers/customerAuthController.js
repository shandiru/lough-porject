// controllers/customerAuthController.js
import User from '../models/user.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';
import { sendMail } from '../utils/mailer.js';
import {
    verifyEmailTemplate,
    resendVerifyEmailTemplate,
    forgotPasswordTemplate,
} from '../utils/emailTemplates.js';

// ─── Helper: generate token + expiry ─────────────────────────────────────────
const generateVerifyToken = () => ({
    token: crypto.randomBytes(32).toString('hex'),
    expires: Date.now() + 5 * 60 * 1000,
});


// ─── Register ─────────────────────────────────────────────────────────────────
export const registerCustomer = async (req, res) => {
    const { firstName, lastName, email, phone, gender, password } = req.body;
    try {
        const existing = await User.findOne({ email });

        if (existing && existing.isActive) {
            return res.status(400).json({ message: 'Email already registered!' });
        }
        if (existing && !existing.isActive) {
            await User.deleteOne({ email, isActive: false });
        }

        const { token, expires } = generateVerifyToken();

        const newUser = new User({
            firstName, lastName, email, phone, gender,
            password: await bcrypt.hash(password, 10),
            role: 'customer',
            isActive: false,
            emailVerifyToken: token,
            emailVerifyTokenExpire: expires,
        });
        await newUser.save();

        const link = `${config.serverUrl}/api/customer/auth/verify-email?token=${token}&email=${email}`;
        await sendMail(email, verifyEmailTemplate(firstName, link));

        res.status(200).json({ message: 'Verification email sent! Please check your inbox.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Verify Email ─────────────────────────────────────────────────────────────
export const verifyEmail = async (req, res) => {
    const { token, email } = req.query;
    try {
        const user = await User.findOne({
            email,
            emailVerifyToken: token,
            emailVerifyTokenExpire: { $gt: Date.now() },
            isActive: false,
            role: 'customer',
        });

        if (!user) {
            return res.redirect(`${config.userlUrl}/verify-email?status=error`);
        }

        user.isActive = true;
        user.emailVerifyToken = undefined;
        user.emailVerifyTokenExpire = undefined;
        await user.save();

        res.redirect(`${config.userlUrl}/verify-email?status=success&email=${email}`);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Resend Verification ──────────────────────────────────────────────────────
export const resendVerification = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email, isActive: false, role: 'customer' });
        if (!user) {
            return res.status(400).json({ message: 'No pending account found for this email.' });
        }

        const { token, expires } = generateVerifyToken();
        user.emailVerifyToken = token;
        user.emailVerifyTokenExpire = expires;
        await user.save();

        const link = `${config.serverUrl}/api/customer/auth/verify-email?token=${token}&email=${email}`;
        await sendMail(email, resendVerifyEmailTemplate(user.firstName, link));

        res.status(200).json({ message: 'Verification email resent!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Login ────────────────────────────────────────────────────────────────────
export const loginCustomer = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email, role: 'customer' });

        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password!' });
        }

        if (!user.isActive) {
            return res.status(400).json({
                message: 'Email not verified! Please check your inbox.',
                notVerified: true,
                email: user.email,
            });
        }

        if (!(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid email or password!' });
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        res.cookie('customerRefreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
        });

        user.lastLogin = Date.now();
        await user.save();

        res.status(200).json({
            accessToken,
            user: { name: user.firstName, email: user.email, role: user.role, gender: user.gender },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Refresh Token ────────────────────────────────────────────────────────────
export const refreshCustomerToken = async (req, res) => {
    const token = req.cookies.customerRefreshToken;
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    try {
        const decoded = jwt.verify(token, config.jwt.refreshSecret);
        const user = await User.findOne({ _id: decoded.id, isActive: true, role: 'customer' });
        if (!user) return res.status(403).json({ message: 'User not found' });

        res.status(200).json({
            accessToken: generateAccessToken(user),
            user: { name: user.firstName, email: user.email, role: user.role, gender: user.gender },
        });
    } catch (err) {
        return res.status(403).json({ message: 'Invalid refresh token' });
    }
};


// ─── Logout ───────────────────────────────────────────────────────────────────
export const logoutCustomer = async (req, res) => {
    res.clearCookie('customerRefreshToken', {
        httpOnly: true, secure: true, sameSite: 'none', path: '/',
    });
    res.status(200).json({ message: 'Logged out successfully' });
};


// ─── Forgot Password ──────────────────────────────────────────────────────────
export const forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email, isActive: true, role: 'customer' });
        if (!user) {
            return res.status(400).json({ message: 'No active account found for this email.' });
        }

        const { token, expires } = generateVerifyToken();
        user.emailVerifyToken = token;
        user.emailVerifyTokenExpire = expires;
        await user.save();

        const link = `${config.userlUrl}/reset-password?token=${token}&email=${email}`;
        await sendMail(email, forgotPasswordTemplate(user.firstName, link));

        res.status(200).json({ message: 'Password reset link sent! Check your email.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


// ─── Reset Password ───────────────────────────────────────────────────────────
export const resetPasswordConfirm = async (req, res) => {
    const { token, email, newPassword } = req.body;
    try {
        const user = await User.findOne({
            email,
            emailVerifyToken: token,
            emailVerifyTokenExpire: { $gt: Date.now() },
            isActive: true,
            role: 'customer',
        });

        if (!user) return res.status(400).json({ message: 'Invalid or expired link!' });

        user.password = await bcrypt.hash(newPassword, 10);
        user.emailVerifyToken = undefined;
        user.emailVerifyTokenExpire = undefined;
        await user.save();

        res.status(200).json({ message: 'Password reset successfully!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};