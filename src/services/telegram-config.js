// Telegram cho phép 1..256 ký tự, nhưng bot nội bộ này bắt buộc ít nhất 32 để
// secret header không thể bị brute-force thực tế.
const TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const TELEGRAM_ID_PATTERN = /^-?\d+$/;

function parseIdSet(value) {
  const ids = new Set();
  for (const item of String(value || '').split(',')) {
    const id = item.trim();
    if (!id) continue;
    if (!TELEGRAM_ID_PATTERN.test(id)) {
      throw new Error(`Telegram ID không hợp lệ: ${id.slice(0, 20)}`);
    }
    ids.add(id);
  }
  return ids;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (/^(?:1|true|yes)$/i.test(value)) return true;
  if (/^(?:0|false|no)$/i.test(value)) return false;
  throw new Error('Giá trị boolean trong cấu hình Telegram không hợp lệ.');
}

function parseTimeout(value) {
  const timeout = Number(value || 330_000);
  if (!Number.isInteger(timeout) || timeout < 5_000 || timeout > 350_000) {
    throw new Error('APPS_SCRIPT_TIMEOUT_MS phải nằm trong 5000..350000.');
  }
  return timeout;
}

/** Đọc env mà không throw khi Telegram chưa được bật. */
export function loadTelegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const webhookSecret = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const appsScriptUrl = String(env.APPS_SCRIPT_WEB_APP_URL || '').trim();
  const appsScriptSecret = String(env.TELEGRAM_APPS_SCRIPT_SECRET || '');
  const allowedUserIds = parseIdSet(env.TELEGRAM_ALLOWED_USER_IDS);
  const allowedChatIds = parseIdSet(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const allowAllUsers = parseBoolean(env.TELEGRAM_ALLOW_ALL_USERS, false);
  const privateOnly = parseBoolean(env.TELEGRAM_PRIVATE_ONLY, true);
  const timeoutMs = parseTimeout(env.APPS_SCRIPT_TIMEOUT_MS);
  const timeZone = String(env.TELEGRAM_TIME_ZONE || 'Asia/Ho_Chi_Minh').trim();

  const missing = [];
  if (!token) missing.push('TELEGRAM_BOT_TOKEN');
  if (!webhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET');
  if (!appsScriptUrl) missing.push('APPS_SCRIPT_WEB_APP_URL');
  if (!appsScriptSecret) missing.push('TELEGRAM_APPS_SCRIPT_SECRET');
  if (!allowAllUsers && !allowedUserIds.size) {
    missing.push('TELEGRAM_ALLOWED_USER_IDS');
  }

  const enabled = missing.length === 0;
  const validationErrors = [];
  if (webhookSecret && !TELEGRAM_SECRET_PATTERN.test(webhookSecret)) {
    validationErrors.push(
      'TELEGRAM_WEBHOOK_SECRET phải dài 32–256 ký tự và chỉ chứa A-Z, a-z, 0-9, _ hoặc -.',
    );
  }
  if (appsScriptSecret && appsScriptSecret.length < 32) {
    validationErrors.push(
      'TELEGRAM_APPS_SCRIPT_SECRET phải có ít nhất 32 ký tự.',
    );
  }
  if (allowAllUsers && !privateOnly) {
    validationErrors.push(
      'Public mode bắt buộc TELEGRAM_PRIVATE_ONLY=true để không mở bot trong group.',
    );
  }

  return {
    enabled: enabled && validationErrors.length === 0,
    missing,
    validationErrors,
    token,
    botId: token.includes(':') ? token.split(':', 1)[0] : '',
    webhookSecret,
    appsScriptUrl,
    appsScriptSecret,
    appsScriptTimeoutMs: timeoutMs,
    allowedUserIds,
    allowedChatIds,
    allowAllUsers,
    privateOnly,
    timeZone,
  };
}

export { parseIdSet, TELEGRAM_SECRET_PATTERN };
