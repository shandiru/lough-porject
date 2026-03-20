import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import customerAuthRouter from './routes/customerAuthRoutes.js';
import authRoutes    from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter  from './routes/serviceRoutes.js';
import staffRouter    from './routes/staffroutes.js';
import googleRouter   from './routes/googlecalendarroutes.js';
import leaveRouter    from './routes/leaveRoutes.js';
import bookingRouter  from './routes/bookingRoutes.js';
import profileRouter  from './routes/profileRoutes.js';
import paymentRouter  from './routes/paymentRoutes.js';
import auditLogRouter from './routes/auditLogRoutes.js';
import { stripeWebhook } from './controllers/paymentController.js';
import config from './config/index.js';
import { startGoogleCalendarCrons} from "../src/cronJobs/googleCalendarCronjobs.js"
import { startReminderCron } from "../src/cronJobs/reminderCron.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

const allowedOrigins = [config.clientUrl, config.userlUrl].filter(Boolean);

// ── Stripe webhook MUST use raw body BEFORE express.json() ──────────────────
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());
startGoogleCalendarCrons();
startReminderCron();
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',          authRoutes);
app.use('/api/categories',    categoryRouter);
app.use('/api/services',      serviceRouter);
app.use('/api/staff',         staffRouter);
app.use('/api/google',        googleRouter);
app.use('/api/leaves',        leaveRouter);
app.use('/api/profile',       profileRouter);
app.use('/api/bookings',      bookingRouter);
app.use('/api/payments',      paymentRouter);
app.use('/api/customer/auth', customerAuthRouter);
app.use('/api/audit-logs',    auditLogRouter);

app.get('/', (req, res) => res.json({ message: 'Lough Skin API running phase 3 start' }));

export default app;
