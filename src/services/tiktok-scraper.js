/**
 * TikTok profile service — HTTP-only edition.
 *
 * Chromium is deliberately not used: profile data and recent public posts are
 * fetched as JSON through a lightweight HTTP provider. Provider requests are
 * serialized because the public endpoint allows roughly one request/second.
 */

import axios from 'axios';

const DEFAULT_PROVIDER_URL = 'https://www.tikwm.com';
const DEFAULT_REQUEST_INTERVAL_MS = 1_100;
const DEFAULT_VIEWS_LIMIT = 30;
const MAX_VIEWS_LIMIT = 35;

function intFromEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const PROVIDER_URL = (process.env.TIKTOK_HTTP_API_URL || DEFAULT_PROVIDER_URL).replace(/\/$/, '');
const REQUEST_INTERVAL_MS = intFromEnv(
  'TIKTOK_REQUEST_INTERVAL_MS',
  DEFAULT_REQUEST_INTERVAL_MS,
  250,
  10_000,
);
const PROVIDER_RETRIES = intFromEnv('TIKTOK_HTTP_RETRIES', 3, 1, 5);
const VIEWS_LIMIT = intFromEnv('TIKTOK_VIEWS_LIMIT', DEFAULT_VIEWS_LIMIT, 1, MAX_VIEWS_LIMIT);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const http = axios.create({
  baseURL: PROVIDER_URL,
  timeout: 20_000,
  maxRedirects: 5,
  maxContentLength: 5 * 1024 * 1024,
  headers: {
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

let providerQueue = Promise.resolve();
let lastProviderRequestAt = 0;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function serviceError(message, code, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function accountNotFoundError(username) {
  return serviceError(
    `Không tìm thấy tài khoản @${username} hoặc tài khoản đã bị vô hiệu hóa.`,
    'USER_NOT_FOUND',
    404,
    {
      accountHealth: {
        status: 'NOT_FOUND',
        label: 'KHÔNG TÌM THẤY',
        isAccessible: false,
        isPublic: false,
        canReadViews: false,
        reason: 'TikTok không còn trả về hồ sơ công khai cho username này.',
        checkedAt: new Date().toISOString(),
      },
    },
  );
}

/**
 * Serialize calls to the provider to avoid its one-request/second free limit.
 * A rejected task does not break the queue for later requests.
 */
function scheduleProviderRequest(task) {
  const run = providerQueue.then(async () => {
    const elapsed = Date.now() - lastProviderRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await wait(REQUEST_INTERVAL_MS - elapsed);
    }
    lastProviderRequestAt = Date.now();
    return task();
  });

  providerQueue = run.catch(() => undefined);
  return run;
}

function isInvalidUsernameMessage(message) {
  return /unique[_ ]?id.*invalid|user.*(?:not found|does not exist)|account.*not found/i.test(message);
}

function isRetryableProviderMessage(message) {
  return /limit|too many|busy|timeout|temporar|try again|system error|network/i.test(message);
}

async function providerGet(path, params, { username } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= PROVIDER_RETRIES; attempt += 1) {
    try {
      const response = await scheduleProviderRequest(() => http.get(path, {
        params,
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        },
      }));
      const payload = response.data;

      if (Number(payload?.code) === 0 && payload?.data) {
        return payload.data;
      }

      const providerMessage = String(payload?.msg || 'Provider trả về dữ liệu không hợp lệ.');
      if (username && isInvalidUsernameMessage(providerMessage)) {
        throw accountNotFoundError(username);
      }

      lastError = serviceError(
        `Nguồn dữ liệu TikTok từ chối yêu cầu: ${providerMessage}`,
        'PROVIDER_ERROR',
        503,
      );

      if (!isRetryableProviderMessage(providerMessage)) break;
    } catch (error) {
      if (error.code === 'USER_NOT_FOUND') throw error;

      const httpStatus = error.response?.status;
      lastError = serviceError(
        `Không kết nối được nguồn dữ liệu TikTok: ${error.message}`,
        'PROVIDER_UNAVAILABLE',
        503,
      );

      if (httpStatus && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429) {
        break;
      }
    }

    if (attempt < PROVIDER_RETRIES) {
      await wait(Math.min(500 * (2 ** (attempt - 1)), 2_000));
    }
  }

  throw lastError || serviceError(
    'Nguồn dữ liệu TikTok tạm thời không khả dụng.',
    'PROVIDER_UNAVAILABLE',
    503,
  );
}

function nonNegativeInt(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function createAccountHealth(profile, { viewsChecked = false, lastVideoAt = null } = {}) {
  let status = 'ACTIVE';
  let label = 'HOẠT ĐỘNG';
  let reason = 'Hồ sơ công khai truy cập được.';

  if (profile.privateAccount) {
    status = 'ACTIVE_PRIVATE';
    label = 'HOẠT ĐỘNG (RIÊNG TƯ)';
    reason = 'Tài khoản tồn tại nhưng đang ở chế độ riêng tư.';
  } else if (profile.videoCount === 0) {
    status = 'ACTIVE_NO_VIDEOS';
    label = 'HOẠT ĐỘNG (CHƯA CÓ VIDEO)';
    reason = 'Tài khoản tồn tại và công khai nhưng chưa có video công khai.';
  }

  return {
    status,
    label,
    isAccessible: true,
    isPublic: !profile.privateAccount,
    canReadViews: profile.privateAccount
      ? false
      : profile.videoCount === 0 || viewsChecked
        ? true
        : null,
    reason,
    lastVideoAt,
    checkedAt: new Date().toISOString(),
  };
}

function buildProfile(user, stats, source = 'tikwm') {
  if (!user?.uniqueId && !user?.id) return null;

  const profile = {
    id: user.id || user.userId || null,
    secUid: user.secUid || null,
    username: user.uniqueId || user.nickname,
    nickname: user.nickname || user.uniqueId,
    bio: user.signature || '',
    verified: Boolean(user.verified),
    privateAccount: Boolean(user.privateAccount ?? user.secret),
    avatarUrl: user.avatarMedium || user.avatarLarger || user.avatarThumb || null,
    followers: nonNegativeInt(stats?.followerCount ?? stats?.fans),
    following: nonNegativeInt(stats?.followingCount),
    likes: nonNegativeInt(stats?.heartCount ?? stats?.heart ?? stats?.diggCount),
    videoCount: nonNegativeInt(stats?.videoCount),
    totalViews: null,
    viewsVideoCount: 0,
    viewsLimit: VIEWS_LIMIT,
    viewsScope: 'not_requested',
    dataSource: source,
  };

  profile.accountHealth = createAccountHealth(profile);
  return profile;
}

function parseUniversalData(data) {
  if (!data) return null;

  const userInfo = data.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
  if (userInfo?.user) {
    return buildProfile(userInfo.user, userInfo.stats ?? userInfo.statsV2, 'tiktok-html');
  }

  for (const value of Object.values(data)) {
    const module = value?.UserModule;
    if (!module?.users) continue;
    const username = Object.keys(module.users)[0];
    if (username) return buildProfile(module.users[username], module.stats?.[username], 'tiktok-html');
  }

  return null;
}

async function fetchProfileFromProvider(username) {
  const data = await providerGet('/api/user/info', { unique_id: username }, { username });
  const profile = buildProfile(data.user, data.stats);
  if (!profile) {
    throw serviceError(
      'Nguồn dữ liệu trả về hồ sơ không đầy đủ.',
      'INVALID_PROVIDER_DATA',
      502,
    );
  }
  return profile;
}

/**
 * Best-effort fallback for profile fields only. This still uses plain HTTP and
 * never launches a browser. Recent views continue to come from the JSON API.
 */
async function fetchProfileFromTikTokHtml(username) {
  let response;
  try {
    response = await axios.get(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      timeout: 15_000,
      maxRedirects: 5,
      headers: {
        'User-Agent': USER_AGENTS[0],
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    if (error.response?.status === 404) throw accountNotFoundError(username);
    throw serviceError(
      `Không tải được hồ sơ TikTok: ${error.message}`,
      'FETCH_ERROR',
      503,
    );
  }

  const html = String(response.data || '');
  const match = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw serviceError(
      'TikTok không trả về dữ liệu hồ sơ qua HTTP.',
      'PARSE_ERROR',
      503,
    );
  }

  try {
    const profile = parseUniversalData(JSON.parse(match[1]));
    if (profile) return profile;
  } catch (error) {
    throw serviceError(`Không đọc được dữ liệu hồ sơ: ${error.message}`, 'PARSE_ERROR', 502);
  }

  throw serviceError('Cấu trúc hồ sơ TikTok không nhận dạng được.', 'PARSE_ERROR', 502);
}

async function fetchRecentViews(username, limit = VIEWS_LIMIT) {
  const data = await providerGet('/api/user/posts', {
    unique_id: username,
    count: limit,
    cursor: 0,
  }, { username });

  const videos = Array.isArray(data.videos) ? data.videos.slice(0, limit) : [];
  if (videos.some(video => !Number.isFinite(Number(video?.play_count)))) {
    throw serviceError(
      'Một số video không có trường play_count.',
      'INVALID_VIEWS_DATA',
      502,
    );
  }

  const totalViews = videos.reduce(
    (total, video) => total + nonNegativeInt(video.play_count),
    0,
  );
  const newestCreateTime = videos.reduce(
    (newest, video) => Math.max(newest, nonNegativeInt(video.create_time)),
    0,
  );

  return {
    totalViews,
    videoCount: videos.length,
    lastVideoAt: newestCreateTime ? new Date(newestCreateTime * 1_000).toISOString() : null,
  };
}

/**
 * Fetch a TikTok profile and optionally sum views from recent public videos.
 */
export async function fetchUserProfile(username, { includeViews = false } = {}) {
  const clean = username.replace(/^@/, '').trim();

  let profile;
  try {
    profile = await fetchProfileFromProvider(clean);
  } catch (providerError) {
    if (providerError.code === 'USER_NOT_FOUND') throw providerError;
    console.warn(`[TikTok HTTP] Provider profile lỗi (${providerError.message}); thử HTML fallback.`);
    profile = await fetchProfileFromTikTokHtml(clean);
  }

  if (!includeViews) return profile;

  if (profile.privateAccount) {
    profile.viewsScope = 'unavailable_private_account';
    profile.accountHealth = createAccountHealth(profile, { viewsChecked: false });
    return profile;
  }

  if (profile.videoCount === 0) {
    profile.totalViews = 0;
    profile.viewsScope = 'recent_public_videos';
    profile.accountHealth = createAccountHealth(profile, { viewsChecked: true });
    return profile;
  }

  const views = await fetchRecentViews(clean);
  if (views.videoCount === 0) {
    throw serviceError(
      'Tài khoản có video nhưng nguồn dữ liệu không trả về danh sách video công khai.',
      'VIEWS_UNAVAILABLE',
      503,
    );
  }

  profile.totalViews = views.totalViews;
  profile.viewsVideoCount = views.videoCount;
  profile.viewsScope = 'recent_public_videos';
  profile.accountHealth = createAccountHealth(profile, {
    viewsChecked: true,
    lastVideoAt: views.lastVideoAt,
  });
  return profile;
}

export const scraperConfig = Object.freeze({
  providerUrl: PROVIDER_URL,
  requestIntervalMs: REQUEST_INTERVAL_MS,
  retries: PROVIDER_RETRIES,
  viewsLimit: VIEWS_LIMIT,
  browserEnabled: false,
});
