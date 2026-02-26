import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter from './routes/serviceRoutes.js'
import staffRouter from './routes/staffroutes.js';
import googleRouter from './routes/googlecalendarroutes.js';
import Googlebooking from './models/googlebooking.js';
const app = express();
const FrontendURL = process.env.FRONTEND_URL ;
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRouter);
app.use('/api/services', serviceRouter);
app.use('/api/staff', staffRouter);
app.use('/api/google',googleRouter );
app.get('/', (req, res) => {
    res.json({ message: "Welcome to Lough Backend API!" });
});
app.get('/api/bookings', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const bookings = await Googlebooking.find({
      date: { $gte: todayStart },
    }).sort({ date: 1, startTime: 1 });

    return res.status(200).json(bookings);

  } catch (error) {
    console.error('Get bookings error:', error);
    return res.status(500).json({ message: 'Failed to fetch bookings.' });
  }
});
export default app;