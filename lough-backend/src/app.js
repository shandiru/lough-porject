import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter from './routes/serviceRoutes.js'
import staffRouter from './routes/staffroutes.js';
import googleRouter from './routes/googlecalendarroutes.js';
import { startGoogleCalendarCrons } from './cronJobs/googleCalendarCronjobs.js';
import config from '../src/config/index.js'
const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());
//  startGoogleCalendarCrons();
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRouter);
app.use('/api/services', serviceRouter);
app.use('/api/staff', staffRouter);
app.use('/api/google',googleRouter );
app.get('/', (req, res) => {
    res.json({ message: "Welcome to Lough Backend API! phase 1 completed" });
});
export default app;