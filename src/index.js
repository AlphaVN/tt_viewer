/**
 * Entry Point
 * Loads environment variables and starts the HTTP server
 */

import 'dotenv/config';
import app from './app.js';
import { warmUpBrowser } from './services/tiktok-scraper.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        TikTok User API — Ready  🚀       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  URL:    http://localhost:${PORT}            ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Endpoints:                              ║');
  console.log('║  GET /api/user/:username/followers       ║');
  console.log('║  GET /api/user/:username/likes           ║');
  console.log('║  GET /api/user/:username/videos          ║');
  console.log('║  GET /api/user/:username/profile         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Docs:   GET /                           ║');
  console.log('║  Health: GET /health                     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Khởi động Chromium ngay khi server start (background, không block)
  warmUpBrowser().catch(() => {});
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed. Bye!');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[Server] SIGINT received. Shutting down...');
  server.close(() => process.exit(0));
});
