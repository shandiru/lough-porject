import User from '../models/user.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';

const mailer = () => nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.user, pass: config.email.pass },
});


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

        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 60 * 60 * 1000; // 1 hour

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

        await mailer().sendMail({
            to: email,
            subject: 'Verify Your Email – Lough Skin',
            html: `
<div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:30px;background:#F5EDE4;border-radius:20px;border:1px solid #e0d5c8;">
  <h2 style="color:#22B8C8;text-align:center;">Lough Skin</h2>
  <div style="background:white;padding:25px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <p style="color:#444;font-size:16px;">Hi <strong>${firstName}</strong>,</p>
    <p style="color:#555;font-size:15px;line-height:1.6;">Thank you for registering! Please verify your email to activate your account.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${link}" style="display:inline-block;background:#22B8C8;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;">
        Verify My Email
      </a>
    </div>
    <p style="color:#666;font-size:14px;background:#fff3cd;padding:10px;border-radius:6px;text-align:center;">
      <strong>Note:</strong> This link expires in <strong>1 hour</strong>.
    </p>
  </div>
  <p style="color:#999;font-size:12px;margin-top:25px;text-align:center;">
    If you didn't register, please ignore this email.<br>&copy; 2026 Lough Skin.
  </p>
</div>`,
        });

        res.status(200).json({ message: 'Verification email sent! Please check your inbox.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


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


export const resendVerification = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email, isActive: false, role: 'customer' });
        if (!user) {
            return res.status(400).json({ message: 'No pending account found for this email.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        user.emailVerifyToken = token;
        user.emailVerifyTokenExpire = Date.now() + 60 * 60 * 1000;
        await user.save();

        const link = `${config.serverUrl}/api/customer/auth/verify-email?token=${token}&email=${email}`;

        await mailer().sendMail({
            to: email,
            subject: 'Verify Your Email – Lough Skin (Resent)',
            html: `
<div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:30px;background:#F5EDE4;border-radius:20px;">
  <h2 style="color:#22B8C8;text-align:center;">Lough Skin</h2>
  <div style="background:white;padding:25px;border-radius:12px;">
    <p style="color:#444;">Hi <strong>${user.firstName}</strong>, here is your new verification link:</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#22B8C8;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;">
        Verify My Email
      </a>
    </div>
    <p style="color:#666;font-size:14px;background:#fff3cd;padding:10px;border-radius:6px;text-align:center;">Expires in <strong>1 hour</strong>.</p>
  </div>
</div>`,
        });

        res.status(200).json({ message: 'Verification email resent!' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


export const loginCustomer = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email, role: 'customer' });

        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password!' });
        }

        // Email not verified check
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
            user: { name: user.firstName, email: user.email, role: user.role },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

export const refreshCustomerToken = async (req, res) => {
    const token = req.cookies.customerRefreshToken;
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    try {
        const decoded = jwt.verify(token, config.jwt.refreshSecret);
        const user = await User.findOne({ _id: decoded.id, isActive: true, role: 'customer' });
        if (!user) return res.status(403).json({ message: 'User not found' });

        res.status(200).json({
            accessToken: generateAccessToken(user),
            user: { name: user.firstName, email: user.email, role: user.role },
        });
    } catch (err) {
        return res.status(403).json({ message: 'Invalid refresh token' });
    }
};


export const logoutCustomer = async (req, res) => {
    res.clearCookie('customerRefreshToken', {
        httpOnly: true, secure: true, sameSite: 'none', path: '/',
    });
    res.status(200).json({ message: 'Logged out successfully' });
};

export const forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email, isActive: true, role: 'customer' });
        if (!user) {
            return res.status(400).json({ message: 'No active account found for this email.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        user.emailVerifyToken = token;
        user.emailVerifyTokenExpire = Date.now() + 60 * 60 * 1000;
        await user.save();

        const link = `${config.userlUrl}/reset-password?token=${token}&email=${email}`;

        await mailer().sendMail({
            to: email,
            subject: 'Reset Your Password – Lough Skin',
            html: `
<div style="font-family:'Segoe UI',sans-serif;max-width:500px;margin:auto;padding:30px;background:#F5EDE4;border-radius:20px;border:1px solid #e0d5c8;">
  <h2 style="color:#22B8C8;text-align:center;">Lough Skin</h2>
  <div style="background:white;padding:25px;border-radius:12px;">
    <p style="color:#444;">Hello <strong>${user.firstName}</strong>,</p>
    <p style="color:#555;line-height:1.6;">We received a request to reset your password.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#22B8C8;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;">
        Reset My Password
      </a>
    </div>
    <p style="color:#666;font-size:14px;background:#fff3cd;padding:10px;border-radius:6px;text-align:center;"><strong>Expires in 1 hour.</strong></p>
    <p style="color:#777;font-size:13px;">If you didn't request this, ignore this email.</p>
  </div>
  <p style="color:#999;font-size:12px;margin-top:25px;text-align:center;">&copy; 2026 Lough Skin.</p>
</div>`,
        });

        res.status(200).json({ message: 'Password reset link sent! Check your email.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};


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