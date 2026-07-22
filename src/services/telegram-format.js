const TARGET_MESSAGE_LENGTH = 3500;

function oneLine(value, fallback = '—', maxLength = 220) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

function metric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('vi-VN').format(value);
  }
  return oneLine(value);
}

function codePointLength(value) {
  return Array.from(value).length;
}

function telegramTextLength(value) {
  return Math.max(value.length, codePointLength(value));
}

function truncateCodePoints(value, maxLength) {
  const points = Array.from(value);
  if (telegramTextLength(value) <= maxLength) return value;

  const kept = [];
  // Chừa một ký tự cho dấu … và kiểm cả code point lẫn UTF-16 code unit.
  for (const point of points) {
    const candidate = `${kept.join('')}${point}…`;
    if (telegramTextLength(candidate) > maxLength) break;
    kept.push(point);
  }
  return `${kept.join('')}…`;
}

function formatTime(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function accountBlock(account, index) {
  const username = oneLine(account.username, `(hàng ${account.row || '?'})`, 120);
  const lines = [
    `${index + 1}. @${username.replace(/^@/, '')}`,
    `Followers: ${metric(account.followers)}`,
    `Tym: ${metric(account.likes)}`,
    `Video: ${metric(account.videos)}`,
    `Views gần đây: ${metric(account.views)}`,
  ];
  if (account.country) lines.push(`Quốc gia: ${oneLine(account.country)}`);
  if (account.businessStatus) {
    lines.push(`Tình trạng: ${oneLine(account.businessStatus)}`);
  }
  if (account.apiStatus) lines.push(`API: ${oneLine(account.apiStatus)}`);
  if (account.outcome === 'not_found') {
    lines.push('ℹ️ API xác nhận tài khoản không tồn tại/không truy cập được.');
  } else if (account.stale || account.outcome !== 'success') {
    lines.push('⚠️ Cập nhật lỗi; các số liệu trên có thể là dữ liệu cũ.');
  }
  return lines.join('\n');
}

/** Đóng gói theo block account, không cắt đôi một account. */
export function packTelegramBlocks(header, blocks, maxLength = TARGET_MESSAGE_LENGTH) {
  const messages = [];
  let current = header;

  for (const rawBlock of blocks) {
    const block = truncateCodePoints(rawBlock, maxLength - 80);
    const candidate = `${current}\n\n${block}`;
    if (telegramTextLength(candidate) <= maxLength) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = block;
  }
  if (current) messages.push(current);
  return messages;
}

export function formatMachineResult(result, { timeZone = 'Asia/Ho_Chi_Minh' } = {}) {
  const icon = result.failed ? '⚠️' : '✅';
  const skipped = result.excluded + result.missingUsername + result.skippedDuringRun;
  const headerLines = [
    `${icon} ${result.machine} — cập nhật hoàn tất`,
    `Đã cập nhật: ${result.updated} | Lỗi: ${result.failed}`,
    `Bỏ qua: ${skipped} (bị loại: ${result.excluded})`,
  ];
  if (result.notFound) {
    headerLines.push(`Không tìm thấy trên TikTok: ${result.notFound}`);
  }
  const displayTime = formatTime(result.updatedAt, timeZone);
  if (displayTime) headerLines.push(`Thời gian: ${displayTime}`);
  if (result.replayed) headerLines.push('Request trùng: trả lại kết quả đã xử lý.');

  if (!result.accounts.length) {
    headerLines.push(
      result.matched
        ? 'Không có tài khoản đủ điều kiện để trả về.'
        : 'Không tìm thấy tài khoản cho máy này.',
    );
    return [headerLines.join('\n')];
  }

  const blocks = result.accounts.map(accountBlock);
  return packTelegramBlocks(headerLines.join('\n'), blocks);
}

export function formatMachineError(error, machine) {
  const messages = {
    MACHINE_NOT_FOUND: `Không tìm thấy máy ${machine} trong sheet.`,
    BUSY: 'Sheet đang được cập nhật bởi yêu cầu khác. Vui lòng thử lại sau.',
    TIMEOUT: 'Cập nhật quá thời gian. Hãy kiểm tra sheet trước khi thử lại.',
    EXPIRED_REQUEST: 'Yêu cầu cập nhật đã hết hạn. Vui lòng gửi lại mã máy.',
    CONFIG_ERROR: 'Bot hoặc Apps Script chưa được cấu hình đúng.',
    MALFORMED_RESPONSE: 'Apps Script trả kết quả không hợp lệ.',
    NETWORK_ERROR: 'Không kết nối được Apps Script. Vui lòng thử lại sau.',
  };
  return `❌ ${messages[error?.code] || 'Không thể cập nhật máy lúc này.'}`;
}

export { TARGET_MESSAGE_LENGTH, codePointLength, telegramTextLength };
