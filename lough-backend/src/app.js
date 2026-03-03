import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Routes
import authRoutes from './routes/authRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import serviceRouter from './routes/serviceRoutes.js';
import staffRouter from './routes/staffroutes.js';
import googleRouter from './routes/googlecalendarroutes.js';
import leaveRouter from './routes/leaveRoutes.js';
import config from './config/index.js';
import {startStaffLeaveCron} from "../src/cronJobs/staffLeaveCron.js"
const app = express();
const httpServer = createServer(app);


const allowedOrigins = [config.clientUrl, config.userlUrl].filter(Boolean);

const io = new Server(httpServer, {
  cors: { 
    origin: allowedOrigins, 
    credentials: true 
  },
});

io.on('connection', (socket) => {
  socket.on('join', ({ role, staffId }) => {
    if (role === 'admin') socket.join('admin-room');
    if (role === 'staff' && staffId) socket.join(`staff-${staffId}`);
  });
});


app.set('io', io);


app.use(cors({ 
  origin: allowedOrigins, 
  credentials: true 
}));

app.use(express.json());
app.use(cookieParser());


app.use('/api/auth',       authRoutes);
app.use('/api/categories', categoryRouter);
app.use('/api/services',   serviceRouter);
app.use('/api/staff',      staffRouter);
app.use('/api/google',     googleRouter);
app.use('/api/leaves',     leaveRouter);   

app.get('/', (req, res) => res.json({ message: 'Lough Skin API running' }));

export { app, httpServer };
export default httpServer;