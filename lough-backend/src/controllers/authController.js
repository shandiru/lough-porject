import User from '../models/user.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';


export const inviteUser = async (req, res) => {
  const { firstName, lastName, email, phone, gender, role, adminKey } = req.body;
  const adminSecretKey = process.env.ADMIN_SECRET_KEY;
  try {
    if (adminKey !== adminSecretKey) {
      return res.status(401).json({ message: "Incorrect Admin Secret Key!" });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000;
    const userExists = await User.findOne({ email });
    if (userExists && userExists.isActive) {
      return res.status(400).json({ message: "User already exists!" });
    } else {
      await User.deleteOne({ email, isActive: false });
    }
    const newUser = new User({
      firstName, lastName, email, phone, gender, role,
      emailVerifyToken: token,
      emailVerifyTokenExpire: expires,
      password: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
      isActive: false
    });

    await newUser.save();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const link = `${process.env.CLIENT_URL}/setup-password?token=${token}&email=${email}`;
    await transporter.sendMail({
      to: email,
      subject: "Verify Your Account",
      html: `<p>Click <a href="${link}">here</a> to set password. Expire in 5 mins.</p>`
    });

    res.status(200).json({ message: "Invite link sent!" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


export const verifyAndSetup = async (req, res) => {
  const { token, email, password } = req.body;
  try {
    const user = await User.findOne({
      email, emailVerifyToken: token, emailVerifyTokenExpire: { $gt: Date.now() }, isActive: false
    });

    if (!user) return res.status(400).json({ message: "Link expired or invalid!" });

    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.isActive = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyTokenExpire = undefined;
    await user.save();

    res.status(200).json({ message: "Verified! You can login now." });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email, isActive: true });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: "Invalid credentials or account not active!" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);


    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    user.lastLogin = Date.now();
    await user.save();

    res.status(200).json({
      message: "Login successful!",
      accessToken,
      user: { name: user.firstName, role: user.role }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }

};
export const refreshToken = async (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token) return res.status(401).json({ message: "No refresh token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESHTOEKEN_KEY);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(403).json({ message: "User not found" });

    const newAccessToken = generateAccessToken(user);

    res.status(200).json({
      accessToken: newAccessToken,
      user: { name: user.firstName, role: user.role }
    });

  } catch (err) {
    console.error("Refresh Token Error:", err); 
    return res.status(403).json({ message: "Invalid refresh token" });
  }
};


export const logoutUser = async (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/'  
  });
  console.log("Refresh token cookie cleared");
  res.status(200).json({ message: "Logged out successfully" });
};





export const resetPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email, isActive: true });
    if (!user) return res.status(400).json({ message: "User not found or inactive!" });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000;
    user.emailVerifyToken = token;
    user.emailVerifyTokenExpire = expires;
    await user.save();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const link = `${process.env.CLIENT_URL}/reset-password?token=${token}&email=${email}`;
    await transporter.sendMail({
      to: email,
      subject: "Reset Your Password",
      html: `<p>Click <a href="${link}">here</a> to reset your password. Expire in 5 mins.</p>`
    });

    res.status(200).json({ message: "Password reset link sent!" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const resetPasswordConfirm = async (req, res) => {
  const { token, email, newPassword } = req.body;
  try {
    const user = await User.findOne({
      email, emailVerifyToken: token, emailVerifyTokenExpire: { $gt: Date.now() }, isActive: true
    });
    if (!user) return res.status(400).json({ message: "Invalid or expired token!" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.emailVerifyToken = undefined;
    user.emailVerifyTokenExpire = undefined;
    await user.save();
    res.status(200).json({ message: "Password reset successfully!" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

