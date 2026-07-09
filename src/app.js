/**
 * Express Application
 * Sets up middleware, routes, and error handling
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as cache from './services/cache.js';
import userRoutes from './routes/user.routes.js';

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ─── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 30,               // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many requests. Please wait a moment before trying again.',
      code: 'RATE_LIMITED',
    },
  },
});

app.use('/api/', limiter);

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * @route  GET /
 * @desc   API info & available endpoints
 */
app.get('/', (req, res) => {
  res.json({
    name: 'TikTok User API',
    version: '1.0.0',
    description: 'REST API to fetch TikTok user stats (followers, likes, video count)',
    endpoints: [
      {
        method: 'GET',
        path: '/api/user/:username/followers',
        description: 'Lấy số lượng followers',
        example: '/api/user/cristiano/followers',
      },
      {
        method: 'GET',
        path: '/api/user/:username/likes',
        description: 'Lấy tổng số lượt likes',
        example: '/api/user/cristiano/likes',
      },
      {
        method: 'GET',
        path: '/api/user/:username/videos',
        description: 'Lấy số lượng video đã đăng',
        example: '/api/user/cristiano/videos',
      },
      {
        method: 'GET',
        path: '/api/user/:username/profile',
        description: 'Lấy toàn bộ thông tin profile',
        example: '/api/user/cristiano/profile',
      },
    ],
    cache: {
      description: 'Kết quả được cache 5 phút để tránh spam TikTok',
      ttl: '5 minutes',
    },
  });
});

/**
 * @route  GET /health
 * @desc   Health check + cache stats
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cache: cache.stats(),
    timestamp: new Date().toISOString(),
  });
});

// Mount user routes
app.use('/api/user', userRoutes);

// ─── 404 Handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
    },
  });
});

// ─── Global Error Handler ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
});

export default app;
