/**
 * User Controller
 * Handles all /api/user/:username routes.
 * Each endpoint returns a single specific metric.
 *
 * NOTE: No server-side caching — Excel cells act as the cache.
 * If a fetch fails, the Office Script preserves the existing cell value.
 */

import { fetchUserProfile } from '../services/tiktok-scraper.js';

/**
 * Fetch fresh user profile directly from TikTok (no cache)
 * @param {string} username
 * @returns {Promise<Object>}
 */
async function getProfile(username, includeViews = false) {
  const profile = await fetchUserProfile(username, { includeViews });
  return { profile };
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
function errorResponse(res, message, status = 500, code = 'INTERNAL_ERROR') {
  return res.status(status).json({
    success: false,
    error: {
      message,
      code,
    },
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
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
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
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
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
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
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
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user/:username/views  (tổng view từ 30 video gần nhất)
// ─────────────────────────────────────────────────────────────────────────────
export async function getViews(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username, true);
    return successResponse(res, {
      username: profile.username,
      totalViews: profile.totalViews,
      videoCount: profile.videoCount,
      note: profile.privateAccount
        ? 'Tài khoản private, không lấy được views'
        : 'Tổng view từ ' + Math.min(profile.videoCount, 30) + ' video gần nhất',
    });
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
  }
}
