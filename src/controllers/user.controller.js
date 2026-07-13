/**
 * User Controller
 * Handles all /api/user/:username routes.
 * Each endpoint returns a single specific metric.
 *
 * NOTE: No server-side caching — Excel cells act as the cache.
 * If a fetch fails, the Office Script preserves the existing cell value.
 */

import { fetchUserProfile } from '../services/tiktok-scraper.js';

const PROFILE_RESPONSE_TIMEOUT_MS = 5_000;

function profileTimeoutError() {
  const error = new Error(
    'Nguồn TikTok không phản hồi trong 5 giây. Dữ liệu hiện có trên Excel được giữ nguyên.',
  );
  error.code = 'REQUEST_TIMEOUT';
  error.status = 504;
  return error;
}

/**
 * Fetch fresh user profile directly from TikTok (no cache)
 * @param {string} username
 * @returns {Promise<Object>}
 */
async function getProfile(username, includeViews = false) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort(profileTimeoutError());
  }, PROFILE_RESPONSE_TIMEOUT_MS);

  try {
    const profile = await fetchUserProfile(username, {
      includeViews,
      signal: abortController.signal,
    });
    return { profile };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Format a success response
 */
function successResponse(res, data) {
  return res.json({
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Format an error response
 */
function errorResponse(res, message, status = 500, code = 'INTERNAL_ERROR', details = null) {
  const error = {
    message,
    code,
  };
  if (details) error.details = details;

  return res.status(status).json({
    success: false,
    error,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/followers
// ─────────────────────────────────────────────────────────────────────────────
export async function getFollowers(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username);
    return successResponse(res, {
      username: profile.username,
      followers: profile.followers,
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/likes
// ─────────────────────────────────────────────────────────────────────────────
export async function getLikes(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username);
    return successResponse(res, {
      username: profile.username,
      likes: profile.likes,
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/videos
// ─────────────────────────────────────────────────────────────────────────────
export async function getVideoCount(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username);
    return successResponse(res, {
      username: profile.username,
      videoCount: profile.videoCount,
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/profile  (trả về toàn bộ thông tin + views)
// ─────────────────────────────────────────────────────────────────────────────
export async function getFullProfile(req, res) {
  const { username } = req.params;
  // ?views=1 để bật tính năng lấy tổng view (chậm hơn ~1-2s)
  const includeViews = req.query.views === '1' || req.query.views === 'true';
  try {
    const { profile } = await getProfile(username, includeViews);
    return successResponse(res, profile);
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/views  (tổng view từ các video gần nhất)
// ─────────────────────────────────────────────────────────────────────────────
export async function getViews(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username, true);
    const note = profile.privateAccount
      ? 'Tài khoản riêng tư, không thể đọc lượt xem video.'
      : `Tổng view từ ${profile.viewsVideoCount} video công khai gần nhất.`;
    return successResponse(res, {
      username: profile.username,
      totalViews: profile.totalViews,
      videoCount: profile.videoCount,
      viewsVideoCount: profile.viewsVideoCount,
      viewsLimit: profile.viewsLimit,
      viewsScope: profile.viewsScope,
      accountHealth: profile.accountHealth,
      note,
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/health  (khả năng truy cập/sức khỏe tài khoản)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAccountHealth(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username);
    return successResponse(res, {
      username: profile.username,
      accountHealth: profile.accountHealth,
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR', err.details);
  }
}
