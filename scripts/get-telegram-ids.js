import 'dotenv/config';
import axios from 'axios';

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error('Thiếu hoặc sai TELEGRAM_BOT_TOKEN trong file .env.');
  process.exitCode = 1;
} else {
  const apiUrl = `https://api.telegram.org/bot${token}`;
  try {
    const webhookInfo = await axios.get(`${apiUrl}/getWebhookInfo`, {
      timeout: 15_000,
      proxy: false,
    });
    const activeWebhook = webhookInfo.data?.result?.url;
    if (activeWebhook) {
      console.error(
        'Bot đang có webhook; Telegram không cho dùng getUpdates đồng thời. ' +
          'Hãy dùng ID đã lưu hoặc tạm chạy npm run telegram:delete-webhook.',
      );
      process.exitCode = 1;
    } else {
      const response = await axios.get(`${apiUrl}/getUpdates`, {
        timeout: 15_000,
        proxy: false,
      });
      if (response.data?.ok !== true) throw new Error('Telegram API báo lỗi.');

      const identities = new Map();
      for (const update of response.data.result || []) {
        const message = update.message || update.edited_message;
        if (!message?.from?.id || !message?.chat?.id) continue;
        const key = `${message.from.id}:${message.chat.id}`;
        identities.set(key, {
          user_id: String(message.from.id),
          chat_id: String(message.chat.id),
          chat_type: String(message.chat.type || ''),
        });
      }

      if (!identities.size) {
        console.log('Chưa có update. Hãy gửi một tin nhắn cho bot rồi chạy lại lệnh.');
      } else {
        console.log('Các ID tìm thấy (không in nội dung tin nhắn):');
        console.log(JSON.stringify([...identities.values()], null, 2));
      }
    }
  } catch (error) {
    console.error(`Không đọc được Telegram IDs: ${error.message}`);
    process.exitCode = 1;
  }
}
