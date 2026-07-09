/**
 * User Routes
 * Defines all /api/user/:username endpoints
 */

import { Router } from 'express';
import {
  getFollowers,
  getLikes,
  getVideoCount,
  getFullProfile,
} from '../controllers/user.controller.js';

const router = Router();

/**
 * Validate :username param — must be non-empty, max 24 chars, alphanumeric + _ + .
 */
router.param('username', (req, res, next, username) => {
  const clean = username.replace(/^@/, '').trim();
  if (!clean || !/^[\w.]{1,24}$/.test(clean)) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Invalid username. Must be 1-24 characters: letters, numbers, underscore, dot.',
        code: 'INVALID_USERNAME',
      },
    });
  }
  req.params.username = clean;
  next();
});

/**
 * @route   GET /api/user/:username/followers
 * @desc    Lấy số lượng người theo dõi (followers)
 * @example GET /api/user/cristiano/followers
 */
router.get('/:username/followers', getFollowers);

/**
 * @route   GET /api/user/:username/likes
 * @desc    Lấy tổng số lượt thích (likes/hearts)
 * @example GET /api/user/cristiano/likes
 */
router.get('/:username/likes', getLikes);

/**
 * @route   GET /api/user/:username/videos
 * @desc    Lấy số lượng video đã đăng
 * @example GET /api/user/cristiano/videos
 */
router.get('/:username/videos', getVideoCount);

/**
 * @route   GET /api/user/:username/profile
 * @desc    Lấy toàn bộ thông tin profile (followers + likes + videos + ...)
 * @example GET /api/user/cristiano/profile
 */
router.get('/:username/profile', getFullProfile);

export default router;
