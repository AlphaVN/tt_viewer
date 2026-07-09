#!/usr/bin/env node
/**
 * start-with-tunnel.js
 * Khởi động API server + tự động tạo public URL qua localtunnel (không cần cài thêm gì)
 *
 * Chạy: node start-with-tunnel.js
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Dùng localtunnel (cài tự động nếu chưa có)
async function startTunnel(port) {
  let lt;
  try {
    lt = require('localtunnel');
  } catch {
    console.log('📦 Đang cài localtunnel...');
    await new Promise((resolve, reject) => {
      const install = spawn('npm', ['install', 'localtunnel', '--no-save'], {
        stdio: 'inherit',
        shell: true,
      });
      install.on('close', code => code === 0 ? resolve() : reject(new Error('install failed')));
    });
    lt = require('localtunnel');
  }

  const tunnel = await lt({ port, subdomain: `tiktok-api-${Math.random().toString(36).slice(2, 8)}` });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              🌐 PUBLIC URL (dùng cho Excel Online)           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  ${tunnel.url.padEnd(60)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Dán URL này vào Office Script:                              ║');
  console.log(`║  const API_BASE_URL = "${tunnel.url}";`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚠️  Giữ cửa sổ terminal này mở khi dùng Excel Online');
  console.log('   Nhấn Ctrl+C để dừng server\n');

  tunnel.on('close', () => {
    console.log('\n🔌 Tunnel đã đóng. Server vẫn chạy local.');
  });

  tunnel.on('error', (err) => {
    console.error('❌ Tunnel error:', err.message);
  });

  return tunnel;
}

async function main() {
  const PORT = process.env.PORT || 3000;

  // Start API server
  console.log(`\n🚀 Đang khởi động API server trên port ${PORT}...`);
  const server = spawn('node', ['src/index.js'], {
    env: { ...process.env },
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  // Wait for server to be ready
  await new Promise((resolve) => {
    server.stdout.on('data', (data) => {
      process.stdout.write(data);
      if (data.toString().includes('Ready')) {
        resolve();
      }
    });
  });

  // Start public tunnel
  await startTunnel(PORT);
}

main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
