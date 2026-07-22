/**
 * Express Application
 * Sets up middleware, routes, and error handling
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import * as cache from './services/cache.js';
import { scraperConfig } from './services/tiktok-scraper.js';
import { logUnhandledError } from './services/request-log.js';
import userRoutes from './routes/user.routes.js';
import telegramRoutes from './routes/telegram.routes.js';

const app = express();
// Ứng dụng chỉ triển khai sau một Render proxy.
const TRUST_PROXY_HOPS = 1;
app.set('trust proxy', TRUST_PROXY_HOPS);

function clientIpForRateLimit(req) {
  if (TRUST_PROXY_HOPS > 0) {
    const header = req.headers['x-forwarded-for'];
    const forwardedFor = Array.isArray(header) ? header[0] : header;
    const firstAddress = forwardedFor?.split(',')[0]?.trim();
    if (firstAddress && isIP(firstAddress)) return firstAddress;
  }
  return req.ip || req.socket.remoteAddress;
}

// ─── Security Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  req.requestStartedAt = Date.now();
  next();
});
// Mount trước JSON parser toàn cục: secret header được kiểm tra trước khi parse
// body, và webhook có limit riêng 32 KB.
app.use('/telegram', telegramRoutes);
app.use(express.json());

// ─── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 30,               // 30 requests per minute per IP
  keyGenerator: req => ipKeyGenerator(clientIpForRateLimit(req)),
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
      trustProxyHops: TRUST_PROXY_HOPS,
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
      trustProxyHops: TRUST_PROXY_HOPS,
    },
    telegram: telegramRoutes.runtimeStatus,
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
  logUnhandledError(req, err);
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
});

export default app;
