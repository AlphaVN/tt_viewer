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

/** Chỉ chấp nhận mã máy thuần; mọi command/nội dung khác đều invalid. */
export function parseTelegramText(value) {
  if (typeof value !== 'string' || value.length > 128) {
    return { kind: 'invalid' };
  }

  const machine = normalizeMachineCode(value);
  return machine ? { kind: 'machine', machine } : { kind: 'invalid' };
}

export { MACHINE_CODE_PATTERN };
