import axios from 'axios';

const MAX_MESSAGE_LENGTH = 4096;

export class TelegramApiError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'TelegramApiError';
    this.code = code;
  }
}

function codePointLength(value) {
  return Array.from(value).length;
}

function telegramTextLength(value) {
  return Math.max(value.length, codePointLength(value));
}

export class TelegramApiClient {
  constructor({ token, httpClient = axios, wait = setTimeout }) {
    if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      throw new TelegramApiError('CONFIG_ERROR', 'Telegram bot token không hợp lệ.');
    }
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.httpClient = httpClient;
    this.wait = wait;
  }

  async sendMessage(chatId, text) {
    if (!/^-?\d+$/.test(String(chatId))) {
      throw new TelegramApiError('INVALID_CHAT', 'Telegram chat ID không hợp lệ.');
    }
    if (
      typeof text !== 'string' ||
      !text ||
      telegramTextLength(text) > MAX_MESSAGE_LENGTH
    ) {
      throw new TelegramApiError(
        'INVALID_MESSAGE',
        'Nội dung Telegram rỗng hoặc vượt giới hạn.',
      );
    }

    const payload = {
      chat_id: String(chatId),
      text,
      protect_content: true,
      link_preview_options: { is_disabled: true },
    };
    return this.callWithRateLimitRetry('sendMessage', payload);
  }

  async callWithRateLimitRetry(method, payload, attempt = 0) {
    try {
      const response = await this.httpClient.post(
        `${this.baseUrl}/${method}`,
        payload,
        { timeout: 15_000, proxy: false },
      );
      if (response?.data?.ok !== true) {
        throw new TelegramApiError('TELEGRAM_API_ERROR', 'Telegram API báo lỗi.');
      }
      return response.data.result;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;

      const responseBody = error?.response?.data;
      const retryAfter = Number(responseBody?.parameters?.retry_after);
      if (
        responseBody?.error_code === 429 &&
        Number.isFinite(retryAfter) &&
        retryAfter >= 0 &&
        attempt < 2
      ) {
        const waitMs = Math.min((retryAfter + 1) * 1000, 30_000);
        await new Promise(resolve => this.wait(resolve, waitMs));
        return this.callWithRateLimitRetry(method, payload, attempt + 1);
      }

      throw new TelegramApiError(
        'TELEGRAM_NETWORK_ERROR',
        'Không gửi được tin nhắn Telegram.',
        { cause: error },
      );
    }
  }
}

export { MAX_MESSAGE_LENGTH, telegramTextLength };
