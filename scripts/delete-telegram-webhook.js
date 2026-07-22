import 'dotenv/config';
import axios from 'axios';

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error('Thiếu hoặc sai TELEGRAM_BOT_TOKEN trong file .env.');
  process.exitCode = 1;
} else {
  const dropPendingUpdates = /^(?:1|true|yes)$/i.test(
    String(process.env.TELEGRAM_DROP_PENDING_UPDATES || 'false'),
  );
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/deleteWebhook`,
      { drop_pending_updates: dropPendingUpdates },
      { timeout: 15_000, proxy: false },
    );
    if (response.data?.ok !== true) throw new Error('Telegram API báo lỗi.');
    console.log(
      `Đã xóa webhook. Drop pending updates: ${dropPendingUpdates ? 'có' : 'không'}.`,
    );
  } catch (error) {
    console.error(`Không thể xóa webhook: ${error.message}`);
    process.exitCode = 1;
  }
}
