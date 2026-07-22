/**
 * Telegram -> Google Apps Script bridge.
 *
 * File này phải nằm cùng Apps Script project với TikTokFetch.gs. Express nhận
 * webhook Telegram, kiểm tra quyền người dùng rồi gửi request HMAC tới doPost().
 * Không đặt bot token hoặc shared secret trực tiếp trong source code này.
 */

var TELEGRAM_SECRET_PROPERTY = "TELEGRAM_APPS_SCRIPT_SECRET";
var TELEGRAM_ACTION = "refresh_machine";
var TELEGRAM_PROTOCOL_VERSION = 1;
var TELEGRAM_REQUEST_MAX_AGE_SECONDS = 300;
var TELEGRAM_CACHE_SECONDS = 600;
var TELEGRAM_REQUEST_RETENTION_SECONDS = 86400;
var TELEGRAM_REQUEST_PROPERTY_PREFIX = "telegram_done_";
var TELEGRAM_DURABLE_RECEIPT_VERSION = 2;
// Script Properties giới hạn mỗi value ở khoảng 9 KB. Chừa headroom cho cách
// Google tính byte/metadata và không chia một result qua nhiều property để việc
// ghi receipt luôn atomic.
var TELEGRAM_MAX_PROPERTY_VALUE_BYTES = 8000;
var TELEGRAM_MAX_BODY_LENGTH = 16000;
var MACHINE_CODE_PATTERN = /^M\d{3,6}$/;

/** Health check không trả dữ liệu sheet. */
function doGet() {
  return telegramJsonResponse({
    success: true,
    service: "telegram-sheet-bridge",
    version: TELEGRAM_PROTOCOL_VERSION,
  });
}

/**
 * Chạy thủ công một lần trong Apps Script editor trước khi deploy.
 * Hàm chỉ kiểm tra cấu hình/layout và tạo header AX nếu đang trống; không gọi
 * TikTok API và không cập nhật account.
 */
function verifyTelegramBridgeSetup() {
  var secret = PropertiesService.getScriptProperties().getProperty(
    TELEGRAM_SECRET_PROPERTY,
  );
  if (!secret || secret.length < 32) {
    throw new Error(
      "Script Property TELEGRAM_APPS_SCRIPT_SECRET phải có ít nhất 32 ký tự.",
    );
  }
  var sheet = getSheet();
  if (!sheet) throw new Error('Không tìm thấy tab "' + SHEET_NAME + '".');
  validateSheetLayout(sheet);
  ensureApiStatusHeader(sheet);
  Logger.log(
    'OK: tab "' +
      SHEET_NAME +
      '", machine ở J, username ở K, trạng thái API ở AX.',
  );
}

/** Endpoint Web App mà server Node.js gọi. */
function doPost(e) {
  try {
    // Xác thực hoàn toàn trước khi mở spreadsheet.
    var request = parseAndVerifyTelegramRequest(e);

    var result = withScriptLock(function () {
      return runTelegramRequest(request);
    }, 1000);

    return telegramJsonResponse({ success: true, data: result });
  } catch (error) {
    var code = error && error.code ? error.code : "INTERNAL_ERROR";
    var publicMessage = telegramPublicErrorMessage(code);
    var internalDetail = String(
      (error && error.causeMessage) || (error && error.message) || code,
    ).slice(0, 500);
    Logger.log("Telegram bridge error [" + code + "]: " + internalDetail);
    return telegramJsonResponse({
      success: false,
      error: { code: code, message: publicMessage },
    });
  }
}

/**
 * Protocol envelope:
 * { v, ts, nonce, payload, sig }
 * sig = base64url(HMAC_SHA256(secret, "v.ts.nonce.payload"))
 * payload là base64url(JSON UTF-8), nên hai runtime không cần canonicalize JSON.
 */
function parseAndVerifyTelegramRequest(e) {
  var body = e && e.postData ? String(e.postData.contents || "") : "";
  if (!body || body.length > TELEGRAM_MAX_BODY_LENGTH) {
    throw telegramBridgeError("INVALID_REQUEST");
  }

  var envelope;
  try {
    envelope = JSON.parse(body);
  } catch (parseError) {
    throw telegramBridgeError("INVALID_REQUEST");
  }
  if (!envelope || Array.isArray(envelope) || typeof envelope !== "object") {
    throw telegramBridgeError("INVALID_REQUEST");
  }
  if (Number(envelope.v) !== TELEGRAM_PROTOCOL_VERSION) {
    throw telegramBridgeError("UNSUPPORTED_VERSION");
  }

  var timestampText = String(envelope.ts || "");
  var nonce = String(envelope.nonce || "");
  var encodedPayload = String(envelope.payload || "");
  var signature = String(envelope.sig || "");

  if (!/^\d{10,11}$/.test(timestampText)) {
    throw telegramBridgeError("INVALID_TIMESTAMP");
  }
  var timestamp = Number(timestampText);
  var nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !isFinite(timestamp) ||
    Math.abs(nowSeconds - timestamp) > TELEGRAM_REQUEST_MAX_AGE_SECONDS
  ) {
    throw telegramBridgeError("EXPIRED_REQUEST");
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) {
    throw telegramBridgeError("INVALID_REQUEST");
  }
  if (
    !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
    encodedPayload.length > 12000 ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    throw telegramBridgeError("INVALID_REQUEST");
  }

  var secret = PropertiesService.getScriptProperties().getProperty(
    TELEGRAM_SECRET_PROPERTY,
  );
  if (!secret || secret.length < 32) {
    throw telegramBridgeError("CONFIG_ERROR");
  }

  var canonical =
    TELEGRAM_PROTOCOL_VERSION +
    "." +
    timestampText +
    "." +
    nonce +
    "." +
    encodedPayload;
  var expectedSignature = telegramHmacBase64Url(canonical, secret);
  if (!telegramSafeEqual(signature, expectedSignature)) {
    throw telegramBridgeError("UNAUTHORIZED");
  }

  var payload;
  try {
    var payloadBytes = Utilities.base64DecodeWebSafe(
      telegramPadBase64(encodedPayload),
    );
    var payloadText = Utilities.newBlob(payloadBytes)
      .getDataAsString(Utilities.Charset.UTF_8);
    payload = JSON.parse(payloadText);
  } catch (payloadError) {
    throw telegramBridgeError("INVALID_REQUEST");
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw telegramBridgeError("INVALID_REQUEST");
  }
  if (payload.action !== TELEGRAM_ACTION) {
    throw telegramBridgeError("INVALID_ACTION");
  }

  var machine = normalizeMachineCode(payload.machine);
  var requestId = String(payload.request_id || "");
  if (!MACHINE_CODE_PATTERN.test(machine)) {
    throw telegramBridgeError("INVALID_MACHINE");
  }
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(requestId)) {
    throw telegramBridgeError("INVALID_REQUEST");
  }

  return {
    machine: machine,
    nonce: nonce,
    requestId: requestId,
  };
}

/** Chạy bên trong ScriptLock để chống hai máy/trigger ghi cùng lúc. */
function runTelegramRequest(request) {
  var cache = CacheService.getScriptCache();
  var requestCacheKey = telegramCacheKey("request", request.requestId);
  var cachedText = cache.get(requestCacheKey);
  if (cachedText) {
    try {
      var cached = JSON.parse(cachedText);
      if (cached.machine === request.machine) {
        cached.replayed = true;
        return cached;
      }
    } catch (cacheError) {
      /* Cache lỗi/đã cũ thì thực thi lại an toàn. */
    }
  }

  // Script Properties là receipt bền vững qua restart/cache eviction. Receipt
  // chỉ chứa result đã allowlist; không lưu password/email hay request body.
  var durableResult = readDurableTelegramResult(request);
  if (durableResult) return durableResult;

  var nonceCacheKey = telegramCacheKey("nonce", request.nonce);
  if (cache.get(nonceCacheKey)) {
    throw telegramBridgeError("REPLAY_DETECTED");
  }

  var result = refreshMachineAccounts(request.machine);
  result.requestId = request.requestId;
  result.replayed = false;

  writeDurableTelegramReceipt(request, result);

  // Chỉ đánh dấu nonce sau khi cập nhật xong; request lỗi có thể retry an toàn.
  try {
    cache.put(nonceCacheKey, "1", TELEGRAM_CACHE_SECONDS);
    var serialized = JSON.stringify(result);
    if (serialized.length < 90000) {
      cache.put(requestCacheKey, serialized, TELEGRAM_CACHE_SECONDS);
    }
  } catch (cacheWriteError) {
    Logger.log("Không ghi được request cache: " + cacheWriteError.message);
  }

  return result;
}

function readDurableTelegramResult(request) {
  var properties = PropertiesService.getScriptProperties();
  cleanupExpiredTelegramReceipts(properties);
  var key = telegramRequestPropertyKey(request.requestId);
  var text = properties.getProperty(key);
  if (!text) return null;

  var receipt;
  try {
    receipt = JSON.parse(text);
  } catch (parseError) {
    properties.deleteProperty(key);
    return null;
  }
  if (!receipt || Number(receipt.expiresAt || 0) <= Date.now()) {
    properties.deleteProperty(key);
    return null;
  }
  if (receipt.machine !== request.machine) {
    throw telegramBridgeError("INVALID_REQUEST");
  }

  if (
    Number(receipt.version) !== TELEGRAM_DURABLE_RECEIPT_VERSION ||
    !receipt.result
  ) {
    // Receipt v1 chỉ có summary nên không thể phát lại đúng outcome từng
    // account. Xóa và chạy lại thay vì dựng một snapshot hiện tại sai nghĩa.
    properties.deleteProperty(key);
    return null;
  }

  var result = sanitizeDurableTelegramResult(
    receipt.result,
    request.machine,
    request.requestId,
  );
  if (!result) {
    properties.deleteProperty(key);
    return null;
  }
  result.replayed = true;
  return result;
}

function writeDurableTelegramReceipt(request, result) {
  try {
    var safeResult = sanitizeDurableTelegramResult(
      result,
      request.machine,
      request.requestId,
    );
    if (!safeResult) {
      Logger.log("Không ghi durable receipt vì result không hợp lệ.");
      return;
    }
    safeResult.replayed = false;

    var receipt = {
      version: TELEGRAM_DURABLE_RECEIPT_VERSION,
      machine: request.machine,
      completedAt: Date.now(),
      expiresAt: Date.now() + TELEGRAM_REQUEST_RETENTION_SECONDS * 1000,
      result: safeResult,
    };
    var serialized = JSON.stringify(receipt);
    if (telegramUtf8ByteLength(serialized) > TELEGRAM_MAX_PROPERTY_VALUE_BYTES) {
      // Không lưu receipt thiếu account/outcome: cache 10 phút vẫn hoạt động và
      // retry sau đó có thể chạy lại, nhưng tuyệt đối không trả snapshot sai.
      Logger.log(
        "Bỏ qua durable receipt vì result vượt " +
          TELEGRAM_MAX_PROPERTY_VALUE_BYTES +
          " byte.",
      );
      return;
    }

    PropertiesService.getScriptProperties().setProperty(
      telegramRequestPropertyKey(request.requestId),
      serialized,
    );
  } catch (propertyError) {
    Logger.log("Không ghi được durable request receipt: " + propertyError.message);
  }
}

/**
 * Clone result theo allowlist trước khi ghi/đọc Script Properties.
 * Trả null nếu receipt không khớp request để caller xóa và thực thi lại.
 */
function sanitizeDurableTelegramResult(result, expectedMachine, expectedRequestId) {
  if (!result || Array.isArray(result) || typeof result !== "object") return null;

  var machine = normalizeMachineCode(result.machine);
  var requestId = String(result.requestId || "");
  if (machine !== expectedMachine || requestId !== expectedRequestId) return null;

  var rawAccounts = Array.isArray(result.accounts) ? result.accounts : [];
  var accounts = [];
  for (var index = 0; index < rawAccounts.length && index < 500; index++) {
    var raw = rawAccounts[index];
    if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;

    var businessStatus = telegramSafeCell(raw.businessStatus, 200);
    if (isSkippedStatus(businessStatus)) continue;
    var outcome =
      raw.outcome === "success" || raw.outcome === "not_found"
        ? raw.outcome
        : "error";
    accounts.push({
      row: telegramSafeNonNegativeInteger(raw.row),
      username: String(telegramSafeCell(raw.username, 120)).replace(/^@/, ""),
      followers: telegramSafeCell(raw.followers, 120),
      likes: telegramSafeCell(raw.likes, 120),
      videos: telegramSafeCell(raw.videos, 120),
      views: telegramSafeCell(raw.views, 120),
      country: telegramSafeCell(raw.country, 120),
      businessStatus: businessStatus,
      apiStatus: telegramSafeCell(raw.apiStatus, 200),
      outcome: outcome,
      stale: outcome === "not_found" ? false : Boolean(raw.stale),
    });
  }

  return {
    machine: machine,
    matched: telegramSafeNonNegativeInteger(result.matched),
    eligible: telegramSafeNonNegativeInteger(result.eligible),
    updated: telegramSafeNonNegativeInteger(result.updated),
    notFound: telegramSafeNonNegativeInteger(result.notFound),
    failed: telegramSafeNonNegativeInteger(result.failed),
    excluded: telegramSafeNonNegativeInteger(result.excluded),
    missingUsername: telegramSafeNonNegativeInteger(result.missingUsername),
    skippedDuringRun: telegramSafeNonNegativeInteger(result.skippedDuringRun),
    accounts: accounts,
    updatedAt: telegramSafeCell(result.updatedAt, 80),
    requestId: requestId,
    replayed: Boolean(result.replayed),
  };
}

function telegramUtf8ByteLength(value) {
  return Utilities.newBlob(String(value || "")).getBytes().length;
}

function cleanupExpiredTelegramReceipts(properties) {
  var all = properties.getProperties();
  var now = Date.now();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(TELEGRAM_REQUEST_PROPERTY_PREFIX) !== 0) return;
    try {
      var receipt = JSON.parse(all[key]);
      if (!receipt || Number(receipt.expiresAt || 0) <= now) {
        properties.deleteProperty(key);
      }
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
}

function telegramRequestPropertyKey(requestId) {
  var cacheStyleKey = telegramCacheKey("done", requestId);
  return TELEGRAM_REQUEST_PROPERTY_PREFIX +
    cacheStyleKey.slice("telegram_done_".length);
}

/**
 * Cập nhật tất cả account thuộc một máy.
 * Chỉ đọc I:K để chọn dòng; không đọc các cột L:N chứa credential.
 */
function refreshMachineAccounts(machine) {
  var normalizedMachine = normalizeMachineCode(machine);
  if (!MACHINE_CODE_PATTERN.test(normalizedMachine)) {
    throw telegramBridgeError("INVALID_MACHINE");
  }

  var sheet;
  try {
    sheet = getSheet();
    if (!sheet) throw new Error("Không tìm thấy sheet.");
    validateSheetLayout(sheet);
    ensureApiStatusHeader(sheet);
  } catch (layoutError) {
    var configError = telegramBridgeError("CONFIG_ERROR");
    configError.causeMessage = layoutError.message;
    throw configError;
  }

  var lastRow = sheet.getLastRow();
  var rowCount = Math.max(0, lastRow - DATA_START_ROW + 1);
  if (!rowCount) throw telegramBridgeError("MACHINE_NOT_FOUND");

  var selectionValues = sheet
    .getRange(DATA_START_ROW, COL.SKIP_STATUS, rowCount, 3)
    .getDisplayValues();
  var eligibleRows = [];
  var matched = 0;
  var excluded = 0;
  var missingUsername = 0;

  for (var index = 0; index < selectionValues.length; index++) {
    var selection = selectionValues[index]; // I=status, J=machine, K=username
    if (normalizeMachineCode(selection[1]) !== normalizedMachine) continue;

    matched++;
    if (isSkippedStatus(selection[0])) {
      excluded++;
      continue;
    }
    if (!String(selection[2] || "").trim()) {
      missingUsername++;
      continue;
    }
    eligibleRows.push(DATA_START_ROW + index);
  }

  if (!matched) throw telegramBridgeError("MACHINE_NOT_FOUND");

  var accounts = [];
  var updated = 0;
  var notFound = 0;
  var failed = 0;
  var skippedDuringRun = 0;

  for (var rowIndex = 0; rowIndex < eligibleRows.length; rowIndex++) {
    var row = eligibleRows[rowIndex];

    // Kiểm tra lại ngay trước khi gọi API nếu người dùng vừa sửa sheet.
    var currentSelection = sheet
      .getRange(row, COL.SKIP_STATUS, 1, 3)
      .getDisplayValues()[0];
    if (
      normalizeMachineCode(currentSelection[1]) !== normalizedMachine ||
      isSkippedStatus(currentSelection[0]) ||
      !String(currentSelection[2] || "").trim()
    ) {
      skippedDuringRun++;
      continue;
    }

    var outcome = fetchSingleRow(sheet, row, normalizedMachine);
    if (outcome === "success") updated++;
    else if (outcome === "not_found") {
      updated++;
      notFound++;
    }
    else if (outcome === "error") failed++;
    else {
      skippedDuringRun++;
      continue;
    }

    var account = readSafeAccountResult(sheet, row, outcome);
    // Fail closed: trạng thái bị chặn không bao giờ xuất hiện trong response.
    if (!isSkippedStatus(account.businessStatus)) accounts.push(account);
  }

  SpreadsheetApp.flush();
  return {
    machine: normalizedMachine,
    matched: matched,
    eligible: eligibleRows.length,
    updated: updated,
    notFound: notFound,
    failed: failed,
    excluded: excluded,
    missingUsername: missingUsername,
    skippedDuringRun: skippedDuringRun,
    accounts: accounts,
    updatedAt: new Date().toISOString(),
  };
}

/** Chỉ đọc C:K và AX. Tuyệt đối không đọc/trả Pass, Hotmail hay Pass hotmail. */
function readSafeAccountResult(sheet, row, outcome) {
  var values = sheet.getRange(row, COL.FOLLOWERS, 1, 9).getValues()[0];
  return {
    row: row,
    username: telegramSafeCell(values[8], 120).replace(/^@/, ""),
    followers: telegramSafeCell(values[0], 120),
    likes: telegramSafeCell(values[1], 120),
    videos: telegramSafeCell(values[2], 120),
    views: telegramSafeCell(values[3], 120),
    country: telegramSafeCell(values[5], 120),
    businessStatus: telegramSafeCell(values[6], 200),
    apiStatus: telegramSafeCell(
      sheet.getRange(row, COL.STATUS).getDisplayValue(),
      200,
    ),
    outcome: outcome,
    stale: outcome !== "success" && outcome !== "not_found",
  };
}

function normalizeMachineCode(value) {
  return normalizeComparable(value).replace(/\s+/g, "");
}

function telegramSafeCell(value, maxLength) {
  if (typeof value === "number" && isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  return String(value === null || value === undefined ? "" : value).slice(
    0,
    maxLength,
  );
}

function telegramSafeNonNegativeInteger(value) {
  var parsed = Number(value);
  return isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function telegramHmacBase64Url(value, secret) {
  var bytes = Utilities.computeHmacSha256Signature(
    value,
    secret,
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function telegramSafeEqual(left, right) {
  var a = String(left || "");
  var b = String(right || "");
  if (a.length !== b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

function telegramPadBase64(value) {
  var result = String(value || "");
  while (result.length % 4) result += "=";
  return result;
}

function telegramCacheKey(prefix, value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8,
  );
  return "telegram_" +
    prefix +
    "_" +
    Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
}

function telegramBridgeError(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

function telegramPublicErrorMessage(code) {
  var messages = {
    INVALID_REQUEST: "Request không hợp lệ.",
    UNSUPPORTED_VERSION: "Phiên bản giao thức không được hỗ trợ.",
    INVALID_TIMESTAMP: "Timestamp không hợp lệ.",
    EXPIRED_REQUEST: "Request đã hết hạn.",
    UNAUTHORIZED: "Không được phép gọi endpoint.",
    REPLAY_DETECTED: "Request đã được sử dụng.",
    INVALID_ACTION: "Action không hợp lệ.",
    INVALID_MACHINE: "Mã máy không hợp lệ.",
    MACHINE_NOT_FOUND: "Không tìm thấy mã máy trong sheet.",
    BUSY: "Sheet đang được cập nhật. Vui lòng thử lại sau.",
    CONFIG_ERROR: "Apps Script chưa được cấu hình đúng hoặc layout sheet đã đổi.",
    INTERNAL_ERROR: "Có lỗi nội bộ khi cập nhật sheet.",
  };
  return messages[code] || messages.INTERNAL_ERROR;
}

function telegramJsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
