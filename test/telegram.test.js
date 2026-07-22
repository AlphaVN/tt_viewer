import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import express from 'express';
import {
  AppsScriptClient,
  AppsScriptError,
  sanitizeAppsScriptResult,
  signEnvelopeParts,
  validateAppsScriptUrl,
} from '../src/services/apps-script-client.js';
import {
  normalizeMachineCode,
  parseTelegramText,
} from '../src/services/machine-code.js';
import { createTelegramRouter } from '../src/routes/telegram.routes.js';
import {
  TelegramApiClient,
  telegramTextLength as apiTextLength,
} from '../src/services/telegram-api.js';
import { TelegramBotProcessor } from '../src/services/telegram-bot.js';
import { loadTelegramConfig } from '../src/services/telegram-config.js';
import {
  codePointLength,
  formatMachineResult,
  packTelegramBlocks,
  telegramTextLength,
  TARGET_MESSAGE_LENGTH,
} from '../src/services/telegram-format.js';

test('normalizes current and future machine codes without hard-coding the list', () => {
  assert.equal(normalizeMachineCode(' m001 '), 'M001');
  assert.equal(normalizeMachineCode('ｍ０１４'), 'M014');
  assert.equal(normalizeMachineCode('M1000'), 'M1000');
  assert.equal(normalizeMachineCode('M999999'), 'M999999');

  for (const invalid of [
    'M1',
    'M001x',
    'M001 extra',
    'M\u200B001',
    'BỊ BAN',
    'Outr beta',
    `M${'1'.repeat(70)}`,
  ]) {
    assert.equal(normalizeMachineCode(invalid), null, invalid);
  }
});

test('parses only a bare machine code and rejects Telegram commands', () => {
  assert.deepEqual(parseTelegramText('M001'), {
    kind: 'machine',
    machine: 'M001',
  });
  assert.deepEqual(parseTelegramText(' m014 '), {
    kind: 'machine',
    machine: 'M014',
  });
  for (const invalid of [
    '/help',
    '/start',
    '/machine M001',
    '/machine@my_bot M001',
    'M001 extra',
  ]) {
    assert.deepEqual(parseTelegramText(invalid), { kind: 'invalid' }, invalid);
  }
});

test('HMAC matches the cross-runtime Apps Script test vector', () => {
  const payload = Buffer.from(
    JSON.stringify({
      action: 'refresh_machine',
      machine: 'M001',
      request_id: 'telegram:bot:123',
    }),
    'utf8',
  ).toString('base64url');

  assert.equal(
    payload,
    'eyJhY3Rpb24iOiJyZWZyZXNoX21hY2hpbmUiLCJtYWNoaW5lIjoiTTAwMSIsInJlcXVlc3RfaWQiOiJ0ZWxlZ3JhbTpib3Q6MTIzIn0',
  );
  assert.equal(
    signEnvelopeParts({
      version: 1,
      ts: 1710000000,
      nonce: 'abc',
      payload,
      secret: 'test-secret',
    }),
    'zitstNSNWvtHAIj3SeOIOgTQ1t0T5ry_svSnbD82RSg',
  );
});

test('validates production Apps Script /exec URL', () => {
  assert.equal(
    validateAppsScriptUrl('https://script.google.com/macros/s/deployment-id/exec'),
    'https://script.google.com/macros/s/deployment-id/exec',
  );
  assert.throws(
    () => validateAppsScriptUrl('http://script.google.com/macros/s/id/exec'),
    AppsScriptError,
  );
  assert.throws(
    () => validateAppsScriptUrl('https://example.com/macros/s/id/exec'),
    AppsScriptError,
  );
});

test('Apps Script client only retains allowlisted non-credential fields', async () => {
  let postedEnvelope;
  const httpClient = {
    async post(_url, envelope) {
      postedEnvelope = envelope;
      return {
        data: {
          success: true,
          data: {
            machine: 'M001',
            requestId: 'telegram:123:456',
            matched: 1,
            eligible: 1,
            updated: 1,
            failed: 0,
            excluded: 0,
            accounts: [
              {
                row: 2,
                username: 'safe_user',
                followers: 123,
                likes: 456,
                videos: 7,
                views: 890,
                businessStatus: 'Chưa bật kiếm tiền',
                apiStatus: 'HOẠT ĐỘNG',
                outcome: 'success',
                password: 'must-not-leak',
                email: 'private@example.com',
                emailPassword: 'also-secret',
              },
            ],
          },
        },
      };
    },
  };
  const client = new AppsScriptClient({
    url: 'https://script.google.com/macros/s/deployment-id/exec',
    secret: 'x'.repeat(32),
    httpClient,
  });
  const result = await client.refreshMachine('m001', {
    requestId: 'telegram:123:456',
  });

  assert.equal(postedEnvelope.v, 1);
  assert.match(postedEnvelope.sig, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(result.accounts[0]).sort(), [
    'apiStatus',
    'businessStatus',
    'country',
    'followers',
    'likes',
    'outcome',
    'row',
    'stale',
    'username',
    'videos',
    'views',
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /must-not-leak|private@example|also-secret/);
});

test('rejects an Apps Script response for a different machine', () => {
  assert.throws(
    () => sanitizeAppsScriptResult({ machine: 'M002' }, 'M001'),
    error => error.code === 'MALFORMED_RESPONSE',
  );
});

test('fails closed when Apps Script returns excluded accounts or wrong request ID', () => {
  const safeData = {
    machine: 'M001',
    requestId: 'telegram:123:456',
    accounts: [
      { username: 'ok', businessStatus: 'Đang bật kiếm tiền' },
      { username: 'banned', businessStatus: '  bị   ban ' },
      { username: 'beta', businessStatus: 'OUTR BETA' },
    ],
  };
  const result = sanitizeAppsScriptResult(
    safeData,
    'M001',
    'telegram:123:456',
  );
  assert.deepEqual(result.accounts.map(account => account.username), ['ok']);
  assert.throws(
    () => sanitizeAppsScriptResult(safeData, 'M001', 'telegram:123:999'),
    error => error.code === 'MALFORMED_RESPONSE',
  );
});

test('loads private-only Telegram allowlists as string IDs', () => {
  const config = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: '123456:token_value',
    TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_value_123456789012',
    TELEGRAM_ALLOWED_USER_IDS: '123, 456',
    TELEGRAM_ALLOWED_CHAT_IDS: '-10001',
    TELEGRAM_PRIVATE_ONLY: 'true',
    APPS_SCRIPT_WEB_APP_URL:
      'https://script.google.com/macros/s/deployment-id/exec',
    TELEGRAM_APPS_SCRIPT_SECRET: 's'.repeat(32),
  });
  assert.equal(config.enabled, true);
  assert.deepEqual([...config.allowedUserIds], ['123', '456']);
  assert.deepEqual([...config.allowedChatIds], ['-10001']);
  assert.equal(config.allowAllUsers, false);
  assert.equal(config.privateOnly, true);
  assert.equal(config.botId, '123456');
});

test('enables explicit public mode without Telegram allowlists', () => {
  const config = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: '123456:token_value',
    TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_value_123456789012',
    TELEGRAM_ALLOW_ALL_USERS: 'true',
    TELEGRAM_PRIVATE_ONLY: 'true',
    APPS_SCRIPT_WEB_APP_URL:
      'https://script.google.com/macros/s/deployment-id/exec',
    TELEGRAM_APPS_SCRIPT_SECRET: 's'.repeat(32),
  });
  assert.equal(config.enabled, true);
  assert.equal(config.allowAllUsers, true);
  assert.deepEqual([...config.allowedUserIds], []);
  assert.deepEqual(config.missing, []);
});

test('keeps allowlist required by default and forces public mode to private chat', () => {
  const base = {
    TELEGRAM_BOT_TOKEN: '123456:token_value',
    TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_value_123456789012',
    APPS_SCRIPT_WEB_APP_URL:
      'https://script.google.com/macros/s/deployment-id/exec',
    TELEGRAM_APPS_SCRIPT_SECRET: 's'.repeat(32),
  };
  const allowlistMode = loadTelegramConfig(base);
  assert.equal(allowlistMode.enabled, false);
  assert.ok(allowlistMode.missing.includes('TELEGRAM_ALLOWED_USER_IDS'));

  const publicGroupMode = loadTelegramConfig({
    ...base,
    TELEGRAM_ALLOW_ALL_USERS: 'true',
    TELEGRAM_PRIVATE_ONLY: 'false',
  });
  assert.equal(publicGroupMode.enabled, false);
  assert.match(publicGroupMode.validationErrors.join(' '), /private/i);
  assert.throws(
    () => loadTelegramConfig({ ...base, TELEGRAM_ALLOW_ALL_USERS: 'maybe' }),
    /boolean/i,
  );
});

test('does not enable Telegram with a weak webhook secret', () => {
  const config = loadTelegramConfig({
    TELEGRAM_BOT_TOKEN: '123456:token_value',
    TELEGRAM_WEBHOOK_SECRET: 'a',
    TELEGRAM_ALLOWED_USER_IDS: '123',
    APPS_SCRIPT_WEB_APP_URL:
      'https://script.google.com/macros/s/deployment-id/exec',
    TELEGRAM_APPS_SCRIPT_SECRET: 's'.repeat(32),
  });
  assert.equal(config.enabled, false);
  assert.match(config.validationErrors.join(' '), /32–256/);
});

test('formats many Unicode accounts into safe Telegram-sized blocks', () => {
  const accounts = Array.from({ length: 80 }, (_, index) => ({
    row: index + 2,
    username: `user_${index}_🚀`,
    followers: index * 1000,
    likes: index * 2000,
    videos: index,
    views: index * 3000,
    country: 'VN',
    businessStatus: 'Chưa bật kiếm tiền',
    apiStatus: 'HOẠT ĐỘNG',
    outcome: 'success',
    password: 'never-format-this',
  }));
  const messages = formatMachineResult({
    machine: 'M001',
    matched: 80,
    eligible: 80,
    updated: 80,
    failed: 0,
    excluded: 0,
    missingUsername: 0,
    skippedDuringRun: 0,
    updatedAt: '2026-07-22T10:00:00.000Z',
    replayed: false,
    accounts,
  });

  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.ok(codePointLength(message) <= TARGET_MESSAGE_LENGTH);
    assert.ok(message.length <= TARGET_MESSAGE_LENGTH);
    assert.ok(telegramTextLength(message) <= TARGET_MESSAGE_LENGTH);
    assert.doesNotMatch(message, /never-format-this/);
  }
  assert.equal(messages.join('\n').match(/\. @user_/g)?.length, 80);

  const astralMessages = packTelegramBlocks('header', ['🚀'.repeat(3000)]);
  for (const message of astralMessages) {
    assert.ok(message.length <= TARGET_MESSAGE_LENGTH);
    assert.ok(telegramTextLength(message) <= TARGET_MESSAGE_LENGTH);
  }
});

function makeProcessorConfig(overrides = {}) {
  return {
    botId: '123456',
    allowAllUsers: false,
    allowedUserIds: new Set(['42']),
    allowedChatIds: new Set(),
    privateOnly: true,
    timeZone: 'Asia/Ho_Chi_Minh',
    ...overrides,
  };
}

function makeUpdate({ updateId = 10, text = 'm001', userId = 42, chatType = 'private' } = {}) {
  return {
    update_id: updateId,
    message: {
      text,
      from: { id: userId },
      chat: { id: userId, type: chatType },
    },
  };
}

test('processor updates an authorized private chat and deduplicates update_id', async () => {
  const sent = [];
  const calls = [];
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig(),
    telegramClient: {
      async sendMessage(chatId, text) {
        sent.push({ chatId, text });
      },
    },
    appsScriptClient: {
      async refreshMachine(machine, options) {
        calls.push({ machine, options });
        return {
          machine,
          matched: 1,
          eligible: 1,
          updated: 1,
          failed: 0,
          excluded: 0,
          missingUsername: 0,
          skippedDuringRun: 0,
          accounts: [],
          updatedAt: '2026-07-22T10:00:00.000Z',
          replayed: false,
        };
      },
    },
    now: () => 1_000,
  });
  const update = makeUpdate();

  await processor.processUpdate(update);
  await processor.processUpdate(update);

  assert.deepEqual(calls, [
    {
      machine: 'M001',
      options: { requestId: 'telegram:123456:10' },
    },
  ]);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Đang cập nhật/);
  assert.match(sent[1].text, /M001/);
});

test('processor silently drops unauthorized users and rejects groups', async () => {
  let calls = 0;
  const sent = [];
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig(),
    telegramClient: {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
    },
    appsScriptClient: {
      async refreshMachine() {
        calls++;
      },
    },
  });

  await processor.processUpdate(makeUpdate({ updateId: 20, userId: 99 }));
  await processor.processUpdate(makeUpdate({ updateId: 21, chatType: 'group' }));
  assert.equal(calls, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /trò chuyện riêng/i);
});

test('invalid text returns a generic error without calling Apps Script', async () => {
  const calls = [];
  const sent = [];
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig({ allowAllUsers: true }),
    telegramClient: {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
    },
    appsScriptClient: {
      async refreshMachine(machine) {
        calls.push(machine);
        return {
          machine,
          matched: 0,
          eligible: 0,
          updated: 0,
          notFound: 0,
          failed: 0,
          excluded: 0,
          missingUsername: 0,
          skippedDuringRun: 0,
          accounts: [],
          updatedAt: '2026-07-22T10:00:00.000Z',
          replayed: false,
        };
      },
    },
  });

  const invalidMessages = [
    '/help',
    '/start',
    '/machine M001',
    'M001 extra',
    'xin chào',
  ];
  for (const [index, text] of invalidMessages.entries()) {
    await processor.processUpdate(
      makeUpdate({ updateId: 1000 + index, userId: 99, text }),
    );
  }

  assert.deepEqual(calls, []);
  assert.deepEqual(
    sent,
    invalidMessages.map(() => '❌ Yêu cầu không hợp lệ.'),
  );
  assert.doesNotMatch(sent.join('\n'), /M\d|Google Sheet|\/machine/i);

  await processor.processUpdate(
    makeUpdate({ updateId: 1010, userId: 99, text: 'M002' }),
  );
  assert.deepEqual(calls, ['M002']);
});

test('public mode accepts every private user but still rejects groups', async () => {
  const calls = [];
  const sent = [];
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig({
      allowAllUsers: true,
      allowedUserIds: new Set(),
      allowedChatIds: new Set(['42']),
    }),
    telegramClient: {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
    },
    appsScriptClient: {
      async refreshMachine(machine) {
        calls.push(machine);
        return {
          machine,
          matched: 1,
          eligible: 1,
          updated: 1,
          notFound: 0,
          failed: 0,
          excluded: 0,
          missingUsername: 0,
          skippedDuringRun: 0,
          accounts: [],
          updatedAt: '2026-07-22T10:00:00.000Z',
          replayed: false,
        };
      },
    },
  });

  await processor.processUpdate(makeUpdate({ updateId: 22, userId: 99 }));
  await processor.processUpdate(
    makeUpdate({ updateId: 23, userId: 100, chatType: 'group' }),
  );

  assert.deepEqual(calls, ['M001']);
  assert.ok(sent.some(text => /M001/.test(text)));
  assert.ok(sent.some(text => /trò chuyện riêng/i.test(text)));
});

test('processor serializes different machines before calling Apps Script', async () => {
  const calls = [];
  const sent = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const appsScriptClient = {
    async refreshMachine(machine) {
      calls.push(machine);
      if (machine === 'M001') await firstGate;
      return {
        machine,
        matched: 0,
        eligible: 0,
        updated: 0,
        notFound: 0,
        failed: 0,
        excluded: 0,
        missingUsername: 0,
        skippedDuringRun: 0,
        accounts: [],
        updatedAt: '2026-07-22T10:00:00.000Z',
        replayed: false,
      };
    },
  };
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig({
      allowedUserIds: new Set(['42', '43']),
    }),
    telegramClient: {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
    },
    appsScriptClient,
  });

  const first = processor.processUpdate(makeUpdate({ updateId: 30, text: 'M001' }));
  await new Promise(resolve => setImmediate(resolve));
  const second = processor.processUpdate(
    makeUpdate({ updateId: 31, text: 'M002', userId: 43 }),
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, ['M001']);
  assert.ok(sent.some(text => /Đã xếp M002/.test(text)));
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['M001', 'M002']);
});

test('public mode permits only one queued machine request per user', async () => {
  const calls = [];
  const sent = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const processor = new TelegramBotProcessor({
    config: makeProcessorConfig({ allowAllUsers: true }),
    telegramClient: {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
    },
    appsScriptClient: {
      async refreshMachine(machine) {
        calls.push(machine);
        await firstGate;
        return {
          machine,
          matched: 0,
          eligible: 0,
          updated: 0,
          notFound: 0,
          failed: 0,
          excluded: 0,
          missingUsername: 0,
          skippedDuringRun: 0,
          accounts: [],
          updatedAt: '2026-07-22T10:00:00.000Z',
          replayed: false,
        };
      },
    },
  });

  const first = processor.processUpdate(
    makeUpdate({ updateId: 40, userId: 99, text: 'M001' }),
  );
  await new Promise(resolve => setImmediate(resolve));
  await processor.processUpdate(
    makeUpdate({ updateId: 41, userId: 99, text: 'M002' }),
  );

  assert.deepEqual(calls, ['M001']);
  assert.ok(sent.some(text => /Bạn đã có một yêu cầu/.test(text)));
  releaseFirst();
  await first;
});

test('Telegram API retries a 429 and protects result messages', async () => {
  const requests = [];
  let attempts = 0;
  const client = new TelegramApiClient({
    token: '123456:test_token',
    httpClient: {
      async post(url, payload) {
        requests.push({ url, payload });
        attempts++;
        if (attempts === 1) {
          const error = new Error('rate limited');
          error.response = {
            data: { error_code: 429, parameters: { retry_after: 0 } },
          };
          throw error;
        }
        return { data: { ok: true, result: { message_id: 1 } } };
      },
    },
    wait(resolve) {
      resolve();
    },
  });

  await client.sendMessage('42', 'safe result');
  assert.equal(attempts, 2);
  assert.equal(requests[1].payload.protect_content, true);
  assert.equal(requests[1].payload.link_preview_options.is_disabled, true);
  await assert.rejects(
    () => client.sendMessage('42', '🚀'.repeat(3000)),
    error => error.code === 'INVALID_MESSAGE',
  );
  assert.ok(apiTextLength('🚀'.repeat(3000)) > 4096);
});

describeWebhookRoute();

function describeWebhookRoute() {
  let server;
  let baseUrl;
  const scheduled = [];
  const processed = [];

  before(async () => {
    const app = express();
    app.use(
      '/telegram',
      createTelegramRouter({
        config: {
          enabled: true,
          webhookSecret: 'correct_secret_12345678901234567',
        },
        processor: {
          async processUpdate(update) {
            processed.push(update.update_id);
          },
        },
        schedule(callback) {
          scheduled.push(callback);
        },
        logger: { error() {} },
      }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('webhook rejects a wrong Telegram secret header', async () => {
    const response = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret_12345678901234567890',
      },
      body: JSON.stringify({ update_id: 100 }),
    });
    assert.equal(response.status, 401);
    assert.equal(scheduled.length, 0);
  });

  test('webhook ACKs a valid update before scheduling slow work', async () => {
    const response = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token':
          'correct_secret_12345678901234567',
      },
      body: JSON.stringify({ update_id: 101 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(processed, []);
    assert.equal(scheduled.length, 1);

    scheduled.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(processed, [101]);
  });

  test('webhook authenticates before parsing malformed JSON', async () => {
    const unauthorized = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong',
      },
      body: '{',
    });
    assert.equal(unauthorized.status, 401);

    const malformed = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token':
          'correct_secret_12345678901234567',
      },
      body: '{',
    });
    assert.equal(malformed.status, 400);
  });
}

test('Apps Script files parse and protect the real Chủ đề column', async () => {
  const [fetchSource, bridgeSource] = await Promise.all([
    readFile(new URL('../excel/TikTokFetch.gs', import.meta.url), 'utf8'),
    readFile(new URL('../excel/TelegramBridge.gs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotThrow(() => new Function(fetchSource));
  assert.doesNotThrow(() => new Function(bridgeSource));
  assert.match(fetchSource, /STATUS:\s*50/);
  assert.match(fetchSource, /18:\s*"Chủ đề"/);
  assert.doesNotMatch(fetchSource, /STATUS:\s*18/);
  assert.match(fetchSource, /getMaxColumns\(\)/);
  assert.match(fetchSource, /insertColumnsAfter\(maxColumns, COL\.STATUS - maxColumns\)/);
  assert.match(bridgeSource, /getRange\(DATA_START_ROW, COL\.SKIP_STATUS, rowCount, 3\)/);
  assert.match(bridgeSource, /TELEGRAM_REQUEST_PROPERTY_PREFIX/);
  assert.match(bridgeSource, /TELEGRAM_MAX_PROPERTY_VALUE_BYTES\s*=\s*8000/);
  assert.match(bridgeSource, /result:\s*safeResult/);
  assert.doesNotMatch(bridgeSource, /function readMachineSnapshot/);
  assert.match(
    bridgeSource,
    /Utilities\.newBlob\(payloadBytes\)\.getDataAsString\(\)/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /getDataAsString\(Utilities\.Charset\.UTF_8\)/,
  );

  const { sanitizeDurableTelegramResult } = new Function(
    `${fetchSource}\n${bridgeSource}\nreturn { sanitizeDurableTelegramResult };`,
  )();
  const durableResult = sanitizeDurableTelegramResult(
    {
      machine: 'M001',
      requestId: 'telegram:123:456',
      matched: 3,
      eligible: 3,
      updated: 2,
      failed: 1,
      accounts: [
        {
          row: 2,
          username: 'stale_user',
          followers: 10,
          businessStatus: 'Đang bật kiếm tiền',
          outcome: 'error',
          stale: true,
          password: 'must-not-persist',
        },
        {
          row: 3,
          username: 'not_found_user',
          businessStatus: '',
          outcome: 'not_found',
          stale: true,
        },
        {
          row: 4,
          username: 'blocked_user',
          businessStatus: ' bị   ban ',
          outcome: 'success',
        },
      ],
      updatedAt: '2026-07-22T10:00:00.000Z',
    },
    'M001',
    'telegram:123:456',
  );
  assert.equal(durableResult.accounts.length, 2);
  assert.equal(durableResult.accounts[0].outcome, 'error');
  assert.equal(durableResult.accounts[0].stale, true);
  assert.equal(durableResult.accounts[1].outcome, 'not_found');
  assert.equal(durableResult.accounts[1].stale, false);
  assert.doesNotMatch(JSON.stringify(durableResult), /must-not-persist|blocked_user/);

  const gasUtilitiesMock = {
    Charset: { UTF_8: 'utf8' },
    computeHmacSha256Signature(value, key) {
      return createHmac('sha256', key).update(value, 'utf8').digest();
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    },
  };
  const { telegramHmacBase64Url } = new Function(
    'Utilities',
    `${bridgeSource}\nreturn { telegramHmacBase64Url };`,
  )(gasUtilitiesMock);
  assert.equal(
    telegramHmacBase64Url(
      '1.1710000000.abc.eyJhY3Rpb24iOiJyZWZyZXNoX21hY2hpbmUiLCJtYWNoaW5lIjoiTTAwMSIsInJlcXVlc3RfaWQiOiJ0ZWxlZ3JhbTpib3Q6MTIzIn0',
      'test-secret',
    ),
    'zitstNSNWvtHAIj3SeOIOgTQ1t0T5ry_svSnbD82RSg',
  );

  const { ensureApiStatusHeader } = new Function(
    `${fetchSource}\nreturn { ensureApiStatusHeader };`,
  )();
  let maxColumns = 49;
  let inserted = null;
  let header = '';
  const headerRange = {
    getDisplayValue: () => header,
    getFormula: () => '',
    getNote: () => '',
    setValue(value) {
      header = value;
    },
  };
  const appendSheet = {
    getMaxColumns: () => maxColumns,
    insertColumnsAfter(after, count) {
      inserted = { after, count };
      maxColumns += count;
    },
    getRange(row, column) {
      assert.equal(row, 1);
      assert.equal(column, 50);
      return headerRange;
    },
    getMaxRows: () => 10,
  };
  ensureApiStatusHeader(appendSheet);
  assert.deepEqual(inserted, { after: 49, count: 1 });
  assert.equal(header, 'Trạng thái API');

  const occupiedSheet = {
    getMaxColumns: () => 50,
    getMaxRows: () => 3,
    getRange(row) {
      if (row === 1) return headerRange;
      return {
        getValues: () => [['existing'], ['']],
        getFormulas: () => [[''], ['']],
        getNotes: () => [[''], ['']],
      };
    },
  };
  header = '';
  assert.throws(
    () => ensureApiStatusHeader(occupiedSheet),
    /Cột AX có dữ liệu/,
  );

  for (const occupiedValue of [0, false]) {
    header = '';
    const falsyOccupiedSheet = {
      getMaxColumns: () => 50,
      getMaxRows: () => 2,
      getRange(row) {
        if (row === 1) return headerRange;
        return {
          getValues: () => [[occupiedValue]],
          getFormulas: () => [['']],
          getNotes: () => [['']],
        };
      },
    };
    assert.throws(
      () => ensureApiStatusHeader(falsyOccupiedSheet),
      /Cột AX có dữ liệu/,
      `AX chứa ${String(occupiedValue)} phải được coi là đã bị chiếm`,
    );
    assert.equal(header, '');
  }
});
