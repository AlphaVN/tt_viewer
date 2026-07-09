/**
 * In-memory cache with TTL support.
 * Prevents hammering TikTok with repeated requests for the same user.
 */

const cache = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached value
 * @param {string} key
 * @returns {any|null} Cached value or null if missing/expired
 */
export function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set cached value with TTL
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlMs] - Time to live in milliseconds
 */
export function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    cachedAt: new Date().toISOString(),
  });
}

/**
 * Get cached entry metadata
 * @param {string} key
 * @returns {{ cachedAt: string, expiresAt: number }|null}
 */
export function getMeta(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return { cachedAt: entry.cachedAt, expiresAt: new Date(entry.expiresAt).toISOString() };
}

/**
 * Delete a specific key
 * @param {string} key
 */
export function del(key) {
  cache.delete(key);
}

/**
 * Get cache stats
 */
export function stats() {
  let activeCount = 0;
  const now = Date.now();
  for (const [, entry] of cache.entries()) {
    if (now <= entry.expiresAt) activeCount++;
  }
  return { totalKeys: cache.size, activeKeys: activeCount };
}
