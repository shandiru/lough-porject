import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { verifyToken } from '../middleware/verifyToken.js';
import { getMyProfile, updateMyProfile } from '../controllers/profileController.js';

const profileRouter = express.Router();


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


const uploadDir = path.join(__dirname, '../../uploads/profiles');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });


const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `profile-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});


profileRouter.get('/me', verifyToken, getMyProfile);
profileRouter.put('/me', verifyToken, upload.single('profileImage'), updateMyProfile);

export default profileRouter;