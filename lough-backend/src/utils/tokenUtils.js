import jwt from 'jsonwebtoken';

export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, name: user.firstName, role: user.role },
    process.env.JWT_ACCESSTOEKEN_KEY,
    { expiresIn: '60m' }
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESHTOEKEN_KEY,
    { expiresIn: '1d' }
  );
};