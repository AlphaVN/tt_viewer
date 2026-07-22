import 'dotenv/config';
import axios from 'axios';
import { loadTelegramConfig } from '../src/services/telegram-config.js';

function requiredPublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_BASE_URL không hợp lệ.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL phải dùng HTTPS.');
  }
  url.pathname = '/telegram/webhook';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function optionalBoolean(value) {
  if (value === undefined || value === '') return false;
  if (/^(?:1|true|yes)$/i.test(value)) return true;
  if (/^(?:0|false|no)$/i.test(value)) return false;
  throw new Error('TELEGRAM_DROP_PENDING_UPDATES phải là true hoặc false.');
}

async function main() {
  const config = loadTelegramConfig();
  if (!config.enabled) {
    const detail = [...config.missing, ...config.validationErrors].join(', ');
    throw new Error(`Cấu hình Telegram chưa đầy đủ: ${detail}`);
  }

  const webhookUrl = requiredPublicUrl(process.env.PUBLIC_BASE_URL);
  const dropPendingUpdates = optionalBoolean(
    process.env.TELEGRAM_DROP_PENDING_UPDATES,
  );
  const apiUrl = `https://api.telegram.org/bot${config.token}`;
  const response = await axios.post(
    `${apiUrl}/setWebhook`,
    {
      url: webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: dropPendingUpdates,
      max_connections: 20,
    },
    { timeout: 15_000, proxy: false },
  );
  if (response.data?.ok !== true) {
    throw new Error('Telegram từ chối setWebhook.');
  }

  const info = await axios.get(`${apiUrl}/getWebhookInfo`, {
    timeout: 15_000,
    proxy: false,
  });
  if (info.data?.ok !== true) {
    throw new Error('Không đọc được getWebhookInfo.');
  }

  const result = info.data.result || {};
  console.log('Đã đăng ký Telegram webhook.');
  console.log(`URL: ${result.url || webhookUrl}`);
  console.log(`Pending updates: ${result.pending_update_count || 0}`);
  console.log(
    `Đã yêu cầu xóa pending updates: ${dropPendingUpdates ? 'có' : 'không'}`,
  );
  console.log(`Last error: ${result.last_error_message || 'không có'}`);
}

main().catch(error => {
  // Không in Axios config vì URL trong đó chứa bot token.
  console.error(`Không thể đăng ký webhook: ${error.message}`);
  process.exitCode = 1;
});
