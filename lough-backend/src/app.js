import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';

const app = express();
const FrontendURL = process.env.FRONTEND_URL ;
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.get('/', (req, res) => {
    res.json({ message: "Welcome to Lough Backend API!" });
});
export default app;