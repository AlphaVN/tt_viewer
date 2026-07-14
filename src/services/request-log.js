function serializeError(error) {
  if (!error) return null;

  const payload = {
    message: error.message,
    code: error.code,
    status: error.status,
  };

  if (error.details) payload.details = error.details;
  if (error.stack) payload.stack = error.stack;

  return payload;
}

function baseLog(req, extra = {}) {
  return {
    timestamp: new Date().toISOString(),
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl || req?.path,
    ...extra,
  };
}

function writeLog(level, event, req, extra = {}, useError = false) {
  const line = JSON.stringify({
    level,
    event,
    ...baseLog(req, extra),
  });

  if (useError) {
    console.error(line);
    return;
  }

  console.log(line);
}

export function logInvalidUsername(req, username) {
  writeLog('warn', 'invalid_username', req, { username, status: 400 });
}

export function logUserSuccess(req, { username, action, status, durationMs, result }) {
  writeLog('info', 'user_request_success', req, {
    username,
    action,
    status,
    durationMs,
    result,
  });
}

export function logUserError(req, { username, action, status, durationMs, error }) {
  writeLog('error', 'user_request_error', req, {
    username,
    action,
    status,
    durationMs,
    error: serializeError(error),
  }, true);
}

export function logUnhandledError(req, error) {
  writeLog('error', 'unhandled_error', req, {
    status: error?.status || 500,
    error: serializeError(error),
  }, true);
}