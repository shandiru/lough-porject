import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Routes
import authRoutes from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter from './routes/serviceRoutes.js';
import staffRouter from './routes/staffroutes.js';
import googleRouter from './routes/googlecalendarroutes.js';
import leaveRouter from './routes/leaveRoutes.js';
import config from './config/index.js';
import { startStaffLeaveCron } from '../src/cronJobs/staffLeaveCron.js';

const app = express();

const allowedOrigins = [config.clientUrl, config.userlUrl].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
// startStaffLeaveCron();
app.use('/api/auth',       authRoutes);
app.use('/api/categories', categoryRouter);
app.use('/api/services',   serviceRouter);
app.use('/api/staff',      staffRouter);
app.use('/api/google',     googleRouter);
app.use('/api/leaves',     leaveRouter);

app.get('/', (req, res) => res.json({ message: 'Lough Skin API running' }));

export default app;
