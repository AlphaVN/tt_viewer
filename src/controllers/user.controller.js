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
async function getProfile(username) {
  const profile = await fetchUserProfile(username);
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
// GET /api/user/:username/profile  (trả về toàn bộ thông tin)
// ─────────────────────────────────────────────────────────────────────────────
export async function getFullProfile(req, res) {
  const { username } = req.params;
  try {
    const { profile } = await getProfile(username);
    return successResponse(res, profile);
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500, err.code || 'INTERNAL_ERROR');
  }
}
