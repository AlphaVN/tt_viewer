import axios from 'axios';
import { createHmac, randomUUID } from 'node:crypto';
import { normalizeMachineCode } from './machine-code.js';

const PROTOCOL_VERSION = 1;
const ACTION = 'refresh_machine';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,120}$/;

export class AppsScriptError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AppsScriptError';
    this.code = code;
  }
}

export function signEnvelopeParts({
  version = PROTOCOL_VERSION,
  ts,
  nonce,
  payload,
  secret,
}) {
  const canonical = `${version}.${ts}.${nonce}.${payload}`;
  return createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest('base64url');
}

/** Tạo đúng envelope HMAC mà TelegramBridge.gs xác minh. */
export function createSignedEnvelope({
  machine,
  requestId,
  secret,
  nowMs = Date.now(),
  nonce = randomUUID(),
}) {
  const normalizedMachine = normalizeMachineCode(machine);
  if (!normalizedMachine) {
    throw new AppsScriptError('INVALID_MACHINE', 'Mã máy không hợp lệ.');
  }
  if (!REQUEST_ID_PATTERN.test(String(requestId || ''))) {
    throw new AppsScriptError('INVALID_REQUEST', 'Request ID không hợp lệ.');
  }
  if (typeof secret !== 'string' || !secret) {
    throw new AppsScriptError('CONFIG_ERROR', 'Thiếu Apps Script secret.');
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) {
    throw new AppsScriptError('INVALID_REQUEST', 'Nonce không hợp lệ.');
  }

  const payloadObject = {
    action: ACTION,
    machine: normalizedMachine,
    request_id: String(requestId),
  };
  const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8')
    .toString('base64url');
  const ts = String(Math.floor(Number(nowMs) / 1000));
  const sig = signEnvelopeParts({
    version: PROTOCOL_VERSION,
    ts,
    nonce,
    payload,
    secret,
  });

  return {
    v: PROTOCOL_VERSION,
    ts: Number(ts),
    nonce,
    payload,
    sig,
  };
}

export function validateAppsScriptUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppsScriptError('CONFIG_ERROR', 'Apps Script URL không hợp lệ.');
  }

  const validPath = /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'script.google.com' ||
    !validPath
  ) {
    throw new AppsScriptError(
      'CONFIG_ERROR',
      'Apps Script URL phải là deployment /exec trên script.google.com.',
    );
  }
  return url.toString();
}

function safeText(value, maxLength = 240) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, maxLength);
}

function safeMetric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return safeText(value, 120);
}

function safeCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeBusinessStatus(value) {
  let normalized = safeText(value, 200);
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // Giữ chuỗi gốc nếu runtime không hỗ trợ Unicode normalization.
  }
  return normalized.replace(/\s+/g, ' ').trim().toUpperCase();
}

export function isExcludedBusinessStatus(value) {
  const normalized = normalizeBusinessStatus(value);
  return normalized === 'BỊ BAN' || normalized === 'OUTR BETA';
}

/** Allowlist field: unknown keys (đặc biệt credential) bị loại ở đây. */
export function sanitizeAppsScriptResult(
  data,
  expectedMachine,
  expectedRequestId,
) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppsScriptError('MALFORMED_RESPONSE', 'Response thiếu data.');
  }

  const machine = normalizeMachineCode(data.machine);
  if (!machine || machine !== expectedMachine) {
    throw new AppsScriptError(
      'MALFORMED_RESPONSE',
      'Response trả sai mã máy.',
    );
  }
  const requestId = safeText(data.requestId, 120);
  if (expectedRequestId !== undefined && requestId !== expectedRequestId) {
    throw new AppsScriptError(
      'MALFORMED_RESPONSE',
      'Response không khớp request đang chờ.',
    );
  }

  const rawAccounts = Array.isArray(data.accounts)
    ? data.accounts.slice(0, 500)
    : [];
  const accounts = rawAccounts
    .map(account => ({
      row: safeCount(account?.row),
      username: safeText(account?.username, 120),
      followers: safeMetric(account?.followers),
      likes: safeMetric(account?.likes),
      videos: safeMetric(account?.videos),
      views: safeMetric(account?.views),
      country: safeText(account?.country, 120),
      businessStatus: safeText(account?.businessStatus, 200),
      apiStatus: safeText(account?.apiStatus, 200),
      outcome: ['success', 'not_found'].includes(account?.outcome)
        ? account.outcome
        : 'error',
      stale:
        account?.outcome === 'not_found' ? false : Boolean(account?.stale),
    }))
    // Defense in depth: kể cả Apps Script regression/malformed response cũng
    // không thể làm account bị loại xuất hiện trên Telegram.
    .filter(account => !isExcludedBusinessStatus(account.businessStatus));

  return {
    machine,
    matched: safeCount(data.matched),
    eligible: safeCount(data.eligible),
    updated: safeCount(data.updated),
    notFound: safeCount(data.notFound),
    failed: safeCount(data.failed),
    excluded: safeCount(data.excluded),
    missingUsername: safeCount(data.missingUsername),
    skippedDuringRun: safeCount(data.skippedDuringRun),
    updatedAt: safeText(data.updatedAt, 80),
    requestId,
    replayed: Boolean(data.replayed),
    accounts,
  };
}

export class AppsScriptClient {
  constructor({ url, secret, timeoutMs = 330_000, httpClient = axios }) {
    this.url = validateAppsScriptUrl(url);
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new AppsScriptError(
        'CONFIG_ERROR',
        'Apps Script secret phải có ít nhất 32 ký tự.',
      );
    }
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.httpClient = httpClient;
  }

  async refreshMachine(machine, { requestId }) {
    const normalizedMachine = normalizeMachineCode(machine);
    const envelope = createSignedEnvelope({
      machine: normalizedMachine,
      requestId,
      secret: this.secret,
    });

    let response;
    try {
      response = await this.httpClient.post(this.url, envelope, {
        timeout: this.timeoutMs,
        maxRedirects: 5,
        proxy: false,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      const code = error?.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR';
      throw new AppsScriptError(
        code,
        code === 'TIMEOUT'
          ? 'Apps Script phản hồi quá thời gian.'
          : 'Không kết nối được Apps Script.',
        { cause: error },
      );
    }

    let body = response?.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        throw new AppsScriptError(
          'MALFORMED_RESPONSE',
          'Apps Script không trả JSON hợp lệ.',
        );
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AppsScriptError(
        'MALFORMED_RESPONSE',
        'Apps Script không trả object hợp lệ.',
      );
    }
    if (body.success !== true) {
      const code = safeText(body.error?.code, 80) || 'APPS_SCRIPT_ERROR';
      const message = safeText(body.error?.message, 240) || 'Apps Script báo lỗi.';
      throw new AppsScriptError(code, message);
    }

    return sanitizeAppsScriptResult(body.data, normalizedMachine, requestId);
  }
}

export { ACTION as APPS_SCRIPT_ACTION, PROTOCOL_VERSION };
