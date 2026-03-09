import User from '../models/user.js';
import Staff from "../models/staff.js";
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import {
  generateAccessToken,
  generateRefreshToken
} from '../utils/tokenUtils.js';


export const inviteUser = async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    gender,
    role,
    adminKey
  } = req.body;

  try {
    if (adminKey !== config.adminSecretKey) {
      console.log(config.adminSecretKey);
      return res.status(401).json({
        message: "Incorrect Admin Secret Key!"
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000;
    const userExists = await User.findOne({
      email
    });
    if (userExists && userExists.isActive) {
      return res.status(400).json({
        message: "User already exists!"
      });
    } else {
      await User.deleteOne({
        email,
        isActive: false
      });
    }
    const newUser = new User({
      firstName,
      lastName,
      email,
      phone,
      gender,
      role,
      emailVerifyToken: token,
      emailVerifyTokenExpire: expires,
      password: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
      isActive: false
    });

    await newUser.save();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });

    const link = `${config.clientUrl}/setup-password?token=${token}&email=${email}`;
    await transporter.sendMail({
      to: email,
      subject: "Verify Your Account",
      html: `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: auto; padding: 30px; background-color: #F5EDE4; border-radius: 20px; border: 1px solid #e0d5c8;">
    
    <h2 style="color: #22B8C8; margin-bottom: 10px; text-align: center;">Lough Skin Admin Portal</h2>
    
    <div style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <p style="color: #444; font-size: 16px; line-height: 1.6;">
        Hi <strong>${firstName}</strong>,
      </p>
      
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        You have been invited to join the <strong>Lough Skin Management Team</strong> as an Admin. 
        To access your dashboard, you need to set up your secure password first.
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" style="display: inline-block; background: #22B8C8; color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 16px; transition: background 0.3s;">
          Setup Admin Account
        </a>
      </div>

      <p style="color: #666; font-size: 14px; background: #fff3cd; padding: 10px; border-radius: 6px; text-align: center;">
        <strong>Security Note:</strong> This invite link is private and will expire in <strong>5 minutes</strong>.
      </p>
    </div>

    <p style="color: #999; font-size: 12px; margin-top: 25px; text-align: center; line-height: 1.4;">
      If you were not expecting this invitation, please contact the main administrator or ignore this email.
      <br> &copy; 2026 Lough Skin. All rights reserved.
    </p>
  </div>
`,
    });

    res.status(200).json({
      message: "Invite link sent!"
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};


export const verifyAndSetup = async (req, res) => {
  const {
    token,
    email,
    password
  } = req.body;
  try {
    const user = await User.findOne({
      email,
      emailVerifyToken: token,
      emailVerifyTokenExpire: {
        $gt: Date.now()
      },
      isActive: false
    });

    if (!user) return res.status(400).json({
      message: "Link expired or invalid!"
    });

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
    

    res.status(200).json({
      message: "Verified! You can login now."
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};
export const verifyTokenStatus = async (req, res) => {
  const { token, email } = req.body;

  try {
    const user = await User.findOne({
      email,
      emailVerifyToken: token,
      emailVerifyTokenExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        isValid: false,
        message: "Link is invalid or has expired!"
      });
    }


    res.status(200).json({
      isValid: true,
      message: "Token is valid."
    });

  } catch (err) {
    res.status(500).json({
      isValid: false,
      message: err.message
    });
  }
};

export const loginUser = async (req, res) => {
  const {
    email,
    password
  } = req.body;
  try {
    const user = await User.findOne({
      email,
      isActive: true
    });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({
        message: "Invalid credentials or account not active!"
      });
    }

    if (user.role === 'staff') {
      const staff = await Staff.findOne({ userId: user._id });
      if (!staff || !staff.verifiedEmail) {
        const isPendingChange = staff?.pendingEmail;
        return res.status(403).json({ 
          message: isPendingChange
            ? `Your email address has been changed. Please verify your new email (${staff.pendingEmail}) to log in.`
            : "Staff email not verified. Please verify your email to login."
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
      path: '/api/auth/refresh'
    });

    user.lastLogin = Date.now();
    await user.save();


    res.status(200).json({
      accessToken,
      user: {
        name: user.firstName,
        role: user.role,

      }
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }

};
export const refreshToken = async (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token) return res.status(401).json({
    message: "No refresh token"
  });

  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);

    const user = await User.findOne({
      _id: decoded.id,
      isActive: true
    });
    if (!user) {

    }
    if (!user) return res.status(403).json({
      message: "User not found"
    });

    const newAccessToken = generateAccessToken(user);

    res.status(200).json({
      accessToken: newAccessToken,
      user: {
        name: user.firstName,
        role: user.role
      }
    });

  } catch (err) {
    console.error("Refresh Token Error:");
    return res.status(403).json({
      message: "Invalid refresh token"
    });
  }
};


export const logoutUser = async (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
   path: '/api/auth/refresh'
  });

  res.status(200).json({
    message: "Logged out successfully"
  });
};





export const resetPassword = async (req, res) => {
  const {
    email
  } = req.body;
  try {
    const user = await User.findOne({
      email,
      isActive: true
    });
    if (!user) return res.status(400).json({
      message: "User not found or inactive!"
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000;
    user.emailVerifyToken = token;
    user.emailVerifyTokenExpire = expires;
    await user.save();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });

    const link = `${config.clientUrl}/reset-password?token=${token}&email=${email}`;
    await transporter.sendMail({
      to: email,
      subject: "Reset Your Password - Lough Skin",
      html: `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: auto; padding: 30px; background-color: #F5EDE4; border-radius: 20px; border: 1px solid #e0d5c8;">
    
    <h2 style="color: #22B8C8; margin-bottom: 10px; text-align: center;">Lough Skin </h2>
    
    <div style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <p style="color: #444; font-size: 16px; line-height: 1.6;">
        Hello,
      </p>
      
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        We received a request to reset the password for your <strong>Lough Skin </strong> account. No changes have been made yet.
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" style="display: inline-block; background: #22B8C8; color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 16px;">
          Reset My Password
        </a>
      </div>

      <div style="background: #fff3cd; padding: 12px; border-radius: 6px; text-align: center;">
        <p style="color: #856404; font-size: 14px; margin: 0;">
          <strong>Security Notice:</strong> This link is valid for <strong>5 minutes</strong> only.
        </p>
      </div>
      
      <p style="color: #777; font-size: 13px; margin-top: 20px; line-height: 1.5;">
        If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
      </p>
    </div>

    <p style="color: #999; font-size: 12px; margin-top: 25px; text-align: center; line-height: 1.4;">
      &copy; 2026 Lough Skin. Secure Admin Access.
    </p>
  </div>
`,
    });

    res.status(200).json({
      message: "Password reset link sent!"
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};

export const resetPasswordConfirm = async (req, res) => {
  const {
    token,
    email,
    newPassword
  } = req.body;
  try {
    const user = await User.findOne({
      email,
      emailVerifyToken: token,
      emailVerifyTokenExpire: {
        $gt: Date.now()
      },
      isActive: true
    });
    if (!user) return res.status(400).json({
      message: "Invalid or expired token!"
    });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.emailVerifyToken = undefined;
    user.emailVerifyTokenExpire = undefined;
    await user.save();
    res.status(200).json({
      message: "Password reset successfully!"
    });
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
};