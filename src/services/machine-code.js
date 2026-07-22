const MACHINE_CODE_PATTERN = /^M\d{3,6}$/;

function normalizeUnicode(value) {
  try {
    return value.normalize('NFKC');
  } catch {
    return value;
  }
}

/**
 * Chuẩn hoá mã máy nhưng không tự đoán/sửa input sai.
 * M001..M999999 hợp lệ, nên các máy thêm sau này không cần sửa source code.
 */
export function normalizeMachineCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const normalized = normalizeUnicode(value).trim().toUpperCase();
  return MACHINE_CODE_PATTERN.test(normalized) ? normalized : null;
}

/** Parse tin nhắn Telegram thành help, machine hoặc invalid. */
export function parseTelegramText(value) {
  if (typeof value !== 'string' || value.length > 128) {
    return { kind: 'invalid' };
  }

  const text = normalizeUnicode(value).trim();
  if (/^\/(?:start|help)(?:@[A-Za-z0-9_]+)?$/i.test(text)) {
    return { kind: 'help' };
  }

  const machineCommand = text.match(
    /^\/machine(?:@[A-Za-z0-9_]+)?\s+(.+)$/i,
  );
  const candidate = machineCommand ? machineCommand[1] : text;
  const machine = normalizeMachineCode(candidate);
  return machine ? { kind: 'machine', machine } : { kind: 'invalid' };
}

export { MACHINE_CODE_PATTERN };
