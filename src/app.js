/**
 * Express Application
 * Sets up middleware, routes, and error handling
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as cache from './services/cache.js';
import { scraperConfig } from './services/tiktok-scraper.js';
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
    version: '1.1.0',
    description: 'REST API lấy thống kê, recent views và trạng thái tài khoản TikTok qua HTTP',
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
        description: 'Lấy profile; thêm ?views=1 để tính recent views',
        example: '/api/user/tiktok/profile?views=1',
      },
      {
        method: 'GET',
        path: '/api/user/:username/views',
        description: 'Tổng view các video công khai gần nhất',
        example: '/api/user/tiktok/views',
      },
      {
        method: 'GET',
        path: '/api/user/:username/health',
        description: 'Trạng thái truy cập của tài khoản',
        example: '/api/user/tiktok/health',
      },
    ],
    runtime: {
      browserEnabled: scraperConfig.browserEnabled,
      viewsLimit: scraperConfig.viewsLimit,
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
    scraper: {
      browserEnabled: scraperConfig.browserEnabled,
      mode: 'http',
      profileStrategy: scraperConfig.profileStrategy,
      viewsLimit: scraperConfig.viewsLimit,
    },
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
