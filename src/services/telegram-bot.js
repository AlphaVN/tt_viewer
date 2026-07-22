import { AppsScriptClient } from './apps-script-client.js';
import { parseTelegramText } from './machine-code.js';
import { TelegramApiClient } from './telegram-api.js';
import {
  formatMachineError,
  formatMachineResult,
} from './telegram-format.js';

const UPDATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_JOBS = 20;

export class TelegramBotProcessor {
  constructor({ config, telegramClient, appsScriptClient, now = Date.now }) {
    this.config = config;
    this.telegramClient = telegramClient;
    this.appsScriptClient = appsScriptClient;
    this.now = now;
    this.processedUpdates = new Map();
    this.inFlightMachines = new Set();
    this.inFlightUsers = new Set();
    this.jobTail = Promise.resolve();
    this.pendingJobs = 0;
  }

  isDuplicate(updateId) {
    const now = this.now();
    if (this.processedUpdates.size > 1000) {
      for (const [id, expiresAt] of this.processedUpdates) {
        if (expiresAt <= now) this.processedUpdates.delete(id);
      }
    }
    const key = String(updateId);
    const expiresAt = this.processedUpdates.get(key);
    if (expiresAt && expiresAt > now) return true;
    this.processedUpdates.set(key, now + UPDATE_TTL_MS);
    return false;
  }

  isAuthorized(message) {
    const userId = String(message?.from?.id ?? '');
    const chatId = String(message?.chat?.id ?? '');
    if (!userId || !chatId) return false;
    // Public mode vẫn bị giới hạn bởi privateOnly ở processUpdate(). Hai
    // allowlist được bỏ qua có chủ đích để mọi Telegram user dùng private chat.
    if (this.config.allowAllUsers) return true;
    if (!this.config.allowedUserIds.has(userId)) return false;
    if (
      this.config.allowedChatIds.size &&
      !this.config.allowedChatIds.has(chatId)
    ) {
      return false;
    }
    return true;
  }

  reserveSerialJob() {
    const waitFor = this.jobTail.catch(() => undefined);
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    this.jobTail = waitFor.then(() => gate);
    const jobsAhead = this.pendingJobs;
    this.pendingJobs += 1;
    return {
      jobsAhead,
      waitFor,
      release: () => {
        this.pendingJobs = Math.max(0, this.pendingJobs - 1);
        release();
      },
    };
  }

  async processUpdate(update) {
    if (!Number.isSafeInteger(update?.update_id)) return;
    if (this.isDuplicate(update.update_id)) return;

    const message = update.message;
    if (!message || typeof message.text !== 'string' || !message.chat?.id) return;
    const chatId = String(message.chat.id);

    if (!this.isAuthorized(message)) {
      // Allowlist mode: silent-drop để người lạ không thể dùng bot làm nguồn
      // spam outbound hoặc dò cấu hình quyền truy cập.
      return;
    }
    if (this.config.privateOnly && message.chat.type !== 'private') {
      await this.telegramClient.sendMessage(
        chatId,
        '⛔ Bot chỉ xử lý trong cuộc trò chuyện riêng.',
      );
      return;
    }

    const parsed = parseTelegramText(message.text);
    if (parsed.kind !== 'machine') {
      await this.telegramClient.sendMessage(chatId, '❌ Yêu cầu không hợp lệ.');
      return;
    }

    const { machine } = parsed;
    if (this.inFlightMachines.has(machine)) {
      await this.telegramClient.sendMessage(
        chatId,
        `⏳ ${machine} đang được cập nhật. Vui lòng chờ kết quả hiện tại.`,
      );
      return;
    }
    const userId = String(message.from.id);
    if (this.inFlightUsers.has(userId)) {
      await this.telegramClient.sendMessage(
        chatId,
        '⏳ Bạn đã có một yêu cầu đang chạy hoặc chờ. Vui lòng đợi kết quả.',
      );
      return;
    }
    if (this.pendingJobs >= MAX_PENDING_JOBS) {
      await this.telegramClient.sendMessage(
        chatId,
        '⏳ Hệ thống đang có quá nhiều yêu cầu. Vui lòng thử lại sau.',
      );
      return;
    }

    this.inFlightMachines.add(machine);
    this.inFlightUsers.add(userId);
    const queueSlot = this.reserveSerialJob();
    try {
      if (queueSlot.jobsAhead > 0) {
        await this.telegramClient.sendMessage(
          chatId,
          `🕒 Đã xếp ${machine} sau ${queueSlot.jobsAhead} yêu cầu đang chờ.`,
        );
      }
      await queueSlot.waitFor;
      await this.telegramClient.sendMessage(
        chatId,
        `⏳ Đang cập nhật các tài khoản của ${machine}...`,
      );

      const requestId = `telegram:${this.config.botId}:${update.update_id}`;
      const result = await this.appsScriptClient.refreshMachine(machine, {
        requestId,
      });
      const messages = formatMachineResult(result, {
        timeZone: this.config.timeZone,
      });
      for (const resultMessage of messages) {
        await this.telegramClient.sendMessage(chatId, resultMessage);
      }
    } catch (error) {
      await this.telegramClient.sendMessage(
        chatId,
        formatMachineError(error, machine),
      );
    } finally {
      queueSlot.release();
      this.inFlightMachines.delete(machine);
      this.inFlightUsers.delete(userId);
    }
  }
}

export function createTelegramBotProcessor(config, dependencies = {}) {
  const telegramClient = dependencies.telegramClient || new TelegramApiClient({
    token: config.token,
  });
  const appsScriptClient = dependencies.appsScriptClient || new AppsScriptClient({
    url: config.appsScriptUrl,
    secret: config.appsScriptSecret,
    timeoutMs: config.appsScriptTimeoutMs,
  });
  return new TelegramBotProcessor({
    config,
    telegramClient,
    appsScriptClient,
    now: dependencies.now,
  });
}
