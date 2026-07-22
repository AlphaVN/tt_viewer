import { timingSafeEqual } from 'node:crypto';
import { json, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createTelegramBotProcessor } from '../services/telegram-bot.js';
import { loadTelegramConfig } from '../services/telegram-config.js';

function safeSecretEqual(received, expected) {
  if (!expected) return false;
  const left = Buffer.from(String(received || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createTelegramRouter(options = {}) {
  const router = Router();
  const logger = options.logger || console;
  const envConfigurationAttempted = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_ALLOWED_USER_IDS',
    'APPS_SCRIPT_WEB_APP_URL',
    'TELEGRAM_APPS_SCRIPT_SECRET',
  ].some(key => Boolean(process.env[key]));
  let config;
  let processor = options.processor;
  let initializationError = null;

  try {
    config = options.config || loadTelegramConfig();
    if (config.enabled && !processor) {
      processor = createTelegramBotProcessor(config);
    }
  } catch (error) {
    initializationError = error;
    config = { enabled: false, webhookSecret: '' };
  }

  const schedule = options.schedule || (callback => setImmediate(callback));
  const configurationAttempted = Boolean(
    envConfigurationAttempted ||
      config.token ||
      config.webhookSecret ||
      config.appsScriptUrl ||
      config.appsScriptSecret ||
      config.allowedUserIds?.size,
  );
  if ((!config.enabled || initializationError) && configurationAttempted) {
    logger.warn?.(
      '[Telegram] module bị vô hiệu hóa do cấu hình thiếu hoặc không hợp lệ.',
    );
  }
  router.runtimeStatus = Object.freeze({
    configured: Boolean(config.enabled && !initializationError && processor),
  });

  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED' },
    },
  });

  function authenticateWebhook(req, res, next) {
    if (!config.enabled || initializationError || !processor) {
      return res.status(503).json({
        success: false,
        error: { code: 'TELEGRAM_NOT_CONFIGURED' },
      });
    }
    if (
      !safeSecretEqual(
        req.get('X-Telegram-Bot-Api-Secret-Token'),
        config.webhookSecret,
      )
    ) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
    }
    return next();
  }

  function handleWebhook(req, res) {
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      !Number.isSafeInteger(req.body.update_id)
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_UPDATE' },
      });
    }

    const update = req.body;
    res.status(200).json({ ok: true });

    // ACK Telegram trước; cập nhật nhiều account có thể mất vài phút.
    schedule(() => {
      Promise.resolve(processor.processUpdate(update)).catch(error => {
        logger.error('[Telegram] xử lý update thất bại', {
          updateId: update.update_id,
          code: error?.code || 'UNEXPECTED_ERROR',
        });
      });
    });
    return undefined;
  }

  router.post(
    '/webhook',
    webhookLimiter,
    authenticateWebhook,
    json({ limit: '32kb', strict: true }),
    handleWebhook,
  );

  router.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE' },
      });
    }
    if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JSON' },
      });
    }
    return next(error);
  });

  return router;
}

export { safeSecretEqual };

export default createTelegramRouter();
