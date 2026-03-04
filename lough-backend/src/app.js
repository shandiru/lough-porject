import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// Routes
import authRoutes    from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter  from './routes/serviceRoutes.js';
import staffRouter    from './routes/staffroutes.js';
import googleRouter   from './routes/googlecalendarroutes.js';
import leaveRouter    from './routes/leaveRoutes.js';
import profileRouter  from './routes/profileRoutes.js';   // ← NEW
import config from './config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

const allowedOrigins = [config.clientUrl, config.userlUrl].filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());


app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',       authRoutes);
app.use('/api/categories', categoryRouter);
app.use('/api/services',   serviceRouter);
app.use('/api/staff',      staffRouter);
app.use('/api/google',     googleRouter);
app.use('/api/leaves',     leaveRouter);
app.use('/api/profile',    profileRouter);   // ← NEW

app.get('/', (req, res) => res.json({ message: 'Lough Skin API running' }));

export default app;