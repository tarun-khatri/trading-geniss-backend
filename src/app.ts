import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import authRoutes from './routes/authRoutes';
import tradeRoutes from './routes/tradeRoutes';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: env.ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
}));
app.use(express.json());

// Routes
app.use('/api', authRoutes);
app.use('/api/trade', tradeRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
