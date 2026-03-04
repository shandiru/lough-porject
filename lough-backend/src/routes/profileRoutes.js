import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { verifyToken } from '../middleware/verifyToken.js';
import { getMyProfile, updateMyProfile } from '../controllers/profileController.js';

const profileRouter = express.Router();

// ── Resolve __dirname in ESM ──────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Make sure the uploads/profiles folder exists ──────────────────
const uploadDir = path.join(__dirname, '../../uploads/profiles');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── Multer: disk storage ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // e.g.  profile-1716900000000.jpg
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `profile-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// GET  /api/profile/me
profileRouter.get('/me', verifyToken, getMyProfile);

// PUT  /api/profile/me  (multipart/form-data — 'profileImage' field optional)
profileRouter.put('/me', verifyToken, upload.single('profileImage'), updateMyProfile);

export default profileRouter;