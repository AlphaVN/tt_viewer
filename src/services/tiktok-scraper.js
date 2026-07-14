/**
 * TikTok profile service — HTTP-only edition.
 *
 * Chromium is deliberately not used: profile data and recent public posts are
 * fetched through plain HTTP. Profile metadata is read directly from TikTok's
 * embedded page JSON, with a lightweight JSON provider as fallback. Provider
 * requests are serialized because its public endpoint allows roughly one
 * request/second.
 */

import axios from "axios";

const MAX_VIEWS_LIMIT = 35;
const MISSING_USER_STATUS_CODES = new Set([10202, 10221, 10223]);
const MISSING_USER_MESSAGE_RE =
  /user.*(?:not found|does not exist|doesn['’]t exist|banned)|account.*(?:not found|couldn['’]t be found)|couldn['’]t find (?:this |the )?account/i;

// Cấu hình chạy production được cố định trong mã nguồn, không đọc từ .env.
const PRODUCTION_SCRAPER_CONFIG = Object.freeze({
  providerUrl: "https://api.tikwmapi.com",
  tiktokWebUrl: "https://www.tiktok.com",
  requestIntervalMs: 1_100,
  requestTimeoutMs: 5_000,
  retries: 3,
  viewsLimit: 30,
});

let {
  providerUrl: PROVIDER_URL,
  tiktokWebUrl: TIKTOK_WEB_URL,
  requestIntervalMs: REQUEST_INTERVAL_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  retries: PROVIDER_RETRIES,
  viewsLimit: VIEWS_LIMIT,
} = PRODUCTION_SCRAPER_CONFIG;

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.183 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.154 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.138 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.168 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.7151.120 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.7151.104 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.114 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.93 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.114 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.95 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.205 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.178 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6943.142 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6943.126 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.6834.197 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.6834.181 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.265 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.205 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.91 Safari/537.36",
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function createProviderHttpClient() {
  const apiKey = process.env.TIKWM_API_KEY || "60acdf13b82c871e5fb5f53c2cd3cb1d";
  const headers = {
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (apiKey) {
    headers["x-tikwmapi-key"] = apiKey;
  }
  return axios.create({
    baseURL: PROVIDER_URL,
    timeout: REQUEST_TIMEOUT_MS,
    proxy: false,
    maxRedirects: 5,
    maxContentLength: 5 * 1024 * 1024,
    headers,
  });
}

let http = createProviderHttpClient();

let providerQueue = Promise.resolve();
let lastProviderRequestAt = 0;

/** Chỉ dùng trong test cục bộ; production luôn dùng cấu hình cố định ở trên. */
export function configureTikTokScraperForTest(overrides = {}) {
  const config = { ...PRODUCTION_SCRAPER_CONFIG, ...overrides };
  if (
    !Number.isInteger(config.viewsLimit) ||
    config.viewsLimit < 1 ||
    config.viewsLimit > MAX_VIEWS_LIMIT
  ) {
    throw new Error(
      `viewsLimit must be an integer from 1 to ${MAX_VIEWS_LIMIT}.`,
    );
  }

  PROVIDER_URL = String(config.providerUrl).replace(/\/$/, "");
  TIKTOK_WEB_URL = String(config.tiktokWebUrl).replace(/\/$/, "");
  REQUEST_INTERVAL_MS = Number(config.requestIntervalMs);
  REQUEST_TIMEOUT_MS = Number(config.requestTimeoutMs);
  PROVIDER_RETRIES = Number(config.retries);
  VIEWS_LIMIT = config.viewsLimit;
  http = createProviderHttpClient();
  providerQueue = Promise.resolve();
  lastProviderRequestAt = 0;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Request cancelled.");
}

function waitWithSignal(ms, signal) {
  if (!signal) return wait(ms);
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(onComplete, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason || new Error("Request cancelled."));
    };
    function onComplete() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

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
    "USER_NOT_FOUND",
    404,
    {
      accountHealth: {
        status: "NOT_FOUND",
        label: "KHÔNG TÌM THẤY",
        isAccessible: false,
        isPublic: false,
        canReadViews: false,
        reason: "TikTok không còn trả về hồ sơ công khai cho username này.",
        checkedAt: new Date().toISOString(),
      },
    },
  );
}

function invalidUsernameError() {
  return serviceError("Username is missing.", "INVALID_USERNAME", 400);
}

function normalizeUsername(username) {
  if (typeof username !== "string") throw invalidUsernameError();
  const clean = username.trim().replace(/^@/, "").trim();
  if (!clean) throw invalidUsernameError();
  return clean;
}

/**
 * Serialize calls to the provider to avoid its one-request/second free limit.
 * A rejected task does not break the queue for later requests.
 */
function scheduleProviderRequest(task, signal) {
  const run = providerQueue.then(async () => {
    throwIfAborted(signal);
    const elapsed = Date.now() - lastProviderRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await waitWithSignal(REQUEST_INTERVAL_MS - elapsed, signal);
    }
    throwIfAborted(signal);
    lastProviderRequestAt = Date.now();
    return task();
  });

  providerQueue = run.catch(() => undefined);
  return run;
}

function isInvalidUsernameMessage(message) {
  return /unique[_ ]?id.*invalid|user.*(?:not found|does not exist)|account.*not found/i.test(
    message,
  );
}

function isRetryableProviderMessage(message) {
  return /limit|too many|busy|timeout|temporar|try again|system error|network/i.test(
    message,
  );
}

async function providerGet(path, params, { username, signal } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= PROVIDER_RETRIES; attempt += 1) {
    try {
      const response = await scheduleProviderRequest(() =>
        http.get(path, {
          params,
          signal,
          headers: {
            "User-Agent": getRandomUserAgent(),
          },
        }),
      );
      const payload = response.data;

      if (Number(payload?.code) === 0 && payload?.data) {
        return payload.data;
      }

      const providerMessage = String(
        payload?.msg || "Provider trả về dữ liệu không hợp lệ.",
      );
      if (username && isInvalidUsernameMessage(providerMessage)) {
        throw accountNotFoundError(username);
      }

      lastError = serviceError(
        `Nguồn dữ liệu TikTok từ chối yêu cầu: ${providerMessage}`,
        "PROVIDER_ERROR",
        503,
      );

      if (!isRetryableProviderMessage(providerMessage)) break;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (error.code === "USER_NOT_FOUND") throw error;

      const httpStatus = error.response?.status;
      lastError = serviceError(
        `Không kết nối được nguồn dữ liệu TikTok: ${error.message}`,
        "PROVIDER_UNAVAILABLE",
        503,
      );

      if (
        httpStatus &&
        httpStatus < 500 &&
        httpStatus !== 408 &&
        httpStatus !== 429
      ) {
        break;
      }
    }

    if (attempt < PROVIDER_RETRIES) {
      await waitWithSignal(Math.min(500 * 2 ** (attempt - 1), 2_000), signal);
    }
  }

  throw (
    lastError ||
    serviceError(
      "Nguồn dữ liệu TikTok tạm thời không khả dụng.",
      "PROVIDER_UNAVAILABLE",
      503,
    )
  );
}

function nonNegativeInt(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function createAccountHealth(
  profile,
  { viewsChecked = false, lastVideoAt = null } = {},
) {
  let status = "ACTIVE";
  let label = "HOẠT ĐỘNG";
  let reason = "Hồ sơ công khai truy cập được.";

  if (profile.privateAccount) {
    status = "ACTIVE_PRIVATE";
    label = "HOẠT ĐỘNG (RIÊNG TƯ)";
    reason = "Tài khoản tồn tại nhưng đang ở chế độ riêng tư.";
  } else if (profile.videoCount === 0) {
    status = "ACTIVE_NO_VIDEOS";
    label = "HOẠT ĐỘNG (CHƯA CÓ VIDEO)";
    reason = "Tài khoản tồn tại và công khai nhưng chưa có video công khai.";
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

function buildProfile(user, stats, source = "tikwm") {
  if (!user?.uniqueId && !user?.id) return null;

  const profile = {
    id: user.id || user.userId || null,
    secUid: user.secUid || null,
    username: user.uniqueId || user.nickname,
    nickname: user.nickname || user.uniqueId,
    bio: user.signature || "",
    verified: Boolean(user.verified),
    privateAccount: Boolean(user.privateAccount ?? user.secret),
    avatarUrl:
      user.avatarMedium || user.avatarLarger || user.avatarThumb || null,
    followers: nonNegativeInt(stats?.followerCount ?? stats?.fans),
    following: nonNegativeInt(stats?.followingCount),
    likes: nonNegativeInt(
      stats?.heartCount ?? stats?.heart ?? stats?.diggCount,
    ),
    videoCount: nonNegativeInt(stats?.videoCount),
    diggCount: nonNegativeInt(stats?.diggCount),
    totalViews: null,
    viewsVideoCount: 0,
    viewsLimit: VIEWS_LIMIT,
    viewsScope: "not_requested",
    dataSource: source,
  };

  profile.accountHealth = createAccountHealth(profile);
  return profile;
}

function isStatValue(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  return typeof value === "string" && /^\d+$/.test(value);
}

function hasStatValue(stats, key) {
  return Object.hasOwn(stats, key) && isStatValue(stats[key]);
}

function isCompleteStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  return (
    ["followerCount", "fans"].some((key) => hasStatValue(stats, key)) &&
    hasStatValue(stats, "followingCount") &&
    hasStatValue(stats, "videoCount") &&
    ["heartCount", "heart", "diggCount"].some((key) => hasStatValue(stats, key))
  );
}

function selectUserInfoStats(userInfo) {
  const rounded = userInfo?.stats;
  const exact = userInfo?.statsV2;
  const stats =
    rounded && typeof rounded === "object" && !Array.isArray(rounded)
      ? { ...rounded }
      : {};

  if (exact && typeof exact === "object" && !Array.isArray(exact)) {
    for (const [key, value] of Object.entries(exact)) {
      if (isStatValue(value)) stats[key] = value;
    }
  }

  return isCompleteStats(stats) ? stats : null;
}

function isCompleteUserInfo(userInfo) {
  return (
    Boolean(userInfo?.user?.uniqueId || userInfo?.user?.id) &&
    Boolean(selectUserInfoStats(userInfo))
  );
}

function normalizeUserInfoStats(userInfo) {
  const exactStats = selectUserInfoStats(userInfo);
  if (!exactStats) return null;

  const stats = Object.fromEntries(
    Object.entries(exactStats).map(([key, value]) => {
      if (typeof value !== "string" || !/^\d+$/.test(value))
        return [key, value];
      const number = Number(value);
      return [key, Number.isSafeInteger(number) ? number : value];
    }),
  );
  return { ...userInfo, stats };
}

function extractScriptJson(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<script\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(pattern);
  if (!match) return null;
  return JSON.parse(match[1].trim());
}

function parseUniversalUserInfo(data) {
  const detail = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  if (detail?.userInfo?.user) {
    return { userInfo: detail.userInfo, source: "tiktok-universal-data" };
  }

  const statusCode = Number(detail?.statusCode);
  if (Number.isFinite(statusCode) && statusCode !== 0) {
    return {
      error: {
        statusCode,
        statusMessage: String(detail.statusMsg || ""),
      },
    };
  }

  for (const value of Object.values(data || {})) {
    const module = value?.UserModule;
    if (!module?.users) continue;
    const username = Object.keys(module.users)[0];
    if (!username) continue;
    return {
      userInfo: {
        user: module.users[username],
        stats: module.stats?.[username],
      },
      source: "tiktok-user-module",
    };
  }

  return null;
}

function parseNextUserInfo(data) {
  const pageProps = data?.props?.pageProps;
  const userInfo = pageProps?.userInfo;
  if (userInfo?.user) {
    return { userInfo, source: "tiktok-next-data" };
  }

  const statusCode = Number(userInfo?.statusCode ?? pageProps?.statusCode);
  if (Number.isFinite(statusCode) && statusCode !== 0) {
    return {
      error: {
        statusCode,
        statusMessage: String(
          userInfo?.statusMsg ?? pageProps?.statusMsg ?? "",
        ),
      },
    };
  }

  return null;
}

function isMissingUserPage(result) {
  if (!result?.error) return false;
  return (
    MISSING_USER_STATUS_CODES.has(result.error.statusCode) ||
    MISSING_USER_MESSAGE_RE.test(result.error.statusMessage)
  );
}

function parseUserProfileHtml(html, username) {
  const parsers = [
    ["__UNIVERSAL_DATA_FOR_REHYDRATION__", parseUniversalUserInfo],
    ["__NEXT_DATA__", parseNextUserInfo],
  ];
  let jsonError;
  let incompleteUserInfo = false;

  for (const [scriptId, parser] of parsers) {
    let data;
    try {
      data = extractScriptJson(html, scriptId);
    } catch (error) {
      jsonError = error;
      continue;
    }
    if (!data) continue;

    const result = parser(data);
    if (result?.userInfo) {
      if (isCompleteUserInfo(result.userInfo)) return result;
      incompleteUserInfo = true;
      continue;
    }
    if (isMissingUserPage(result)) throw accountNotFoundError(username);
  }

  if (incompleteUserInfo) {
    throw serviceError(
      "TikTok trả về hồ sơ thiếu user hoặc các trường thống kê bắt buộc.",
      "INVALID_TIKTOK_DATA",
      502,
    );
  }

  if (jsonError) {
    throw serviceError(
      `Không đọc được dữ liệu hồ sơ: ${jsonError.message}`,
      "PARSE_ERROR",
      502,
    );
  }

  throw serviceError(
    "TikTok không trả về dữ liệu hồ sơ nhận dạng được qua HTTP.",
    "PARSE_ERROR",
    503,
  );
}

async function fetchProfileFromProvider(username, signal) {
  const data = await providerGet(
    "/user/info",
    { unique_id: username },
    { username, signal },
  );
  if (
    !data?.user ||
    (!data.user.uniqueId && !data.user.id) ||
    !isCompleteStats(data.stats)
  ) {
    throw serviceError(
      "Nguồn dữ liệu trả về hồ sơ thiếu user hoặc các trường thống kê bắt buộc.",
      "INVALID_PROVIDER_DATA",
      502,
    );
  }
  const profile = buildProfile(data.user, data.stats);
  if (!profile) {
    throw serviceError(
      "Nguồn dữ liệu trả về hồ sơ không đầy đủ.",
      "INVALID_PROVIDER_DATA",
      502,
    );
  }
  return profile;
}

/**
 * Fetch profile fields directly from TikTok using plain HTTP. Recent views
 * continue to come from the JSON API.
 */
async function requestUserProfileInfo(username, signal) {
  let response;
  try {
    response = await axios.get(
      `${TIKTOK_WEB_URL}/@${encodeURIComponent(username)}`,
      {
        timeout: REQUEST_TIMEOUT_MS,
        signal,
        proxy: false,
        maxRedirects: 5,
        maxContentLength: 5 * 1024 * 1024,
        headers: {
          "User-Agent": getRandomUserAgent(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error.response?.status === 404) throw accountNotFoundError(username);
    throw serviceError(
      `Không tải được hồ sơ TikTok: ${error.message}`,
      "FETCH_ERROR",
      503,
    );
  }

  const html = String(response.data || "");
  return parseUserProfileHtml(html, username);
}

/**
 * Fetch TikTok user metadata in the same `{ user, stats }` shape returned by
 * drawrowfly/tiktok-scraper's getUserProfileInfo. Exact statsV2 values are
 * normalized into `stats` when available. Both TikTok's current universal-data
 * page format and the legacy __NEXT_DATA__ format are accepted.
 */
export async function getUserProfileInfo(username, { signal } = {}) {
  const clean = normalizeUsername(username);
  const { userInfo } = await requestUserProfileInfo(clean, signal);
  return normalizeUserInfoStats(userInfo);
}

async function fetchProfileFromTikTokHtml(username, signal) {
  const { userInfo, source } = await requestUserProfileInfo(username, signal);
  const profile = buildProfile(
    userInfo.user,
    selectUserInfoStats(userInfo),
    source,
  );
  if (!profile) {
    throw serviceError(
      "TikTok trả về hồ sơ không đầy đủ.",
      "INVALID_TIKTOK_DATA",
      502,
    );
  }
  return profile;
}

export async function fetchUserProfile(
  username,
  { includeViews = false, signal } = {},
) {
  const clean = normalizeUsername(username);
  throwIfAborted(signal);

  let profile;
  try {
    profile = await fetchProfileFromTikTokHtml(clean, signal);
  } catch (tiktokError) {
    if (signal?.aborted) throw tiktokError;
    console.warn(
      `[TikTok HTTP] TikTok profile lỗi (${tiktokError.message}); thử provider fallback.`,
    );
    try {
      profile = await fetchProfileFromProvider(clean, signal);
    } catch (providerError) {
      if (signal?.aborted) throw signal.reason || providerError;
      if (
        tiktokError.code === "USER_NOT_FOUND" &&
        providerError.code === "USER_NOT_FOUND"
      ) {
        throw tiktokError;
      }
      throw providerError;
    }
  }

  if (includeViews) {
    if (profile.privateAccount) {
      profile.viewsScope = "unavailable_private_account";
      profile.accountHealth = createAccountHealth(profile, {
        viewsChecked: false,
      });
    } else {
      profile.totalViews = profile.diggCount;
      profile.viewsVideoCount = 0;
      profile.viewsScope = "recent_public_videos";
      profile.accountHealth = createAccountHealth(profile, {
        viewsChecked: true,
      });
    }
  }

  delete profile.diggCount;
  return profile;
}

export const scraperConfig = Object.freeze({
  get providerUrl() {
    return PROVIDER_URL;
  },
  get tiktokWebUrl() {
    return TIKTOK_WEB_URL;
  },
  profileStrategy: "tiktok-html-with-provider-fallback",
  get requestIntervalMs() {
    return REQUEST_INTERVAL_MS;
  },
  get requestTimeoutMs() {
    return REQUEST_TIMEOUT_MS;
  },
  get retries() {
    return PROVIDER_RETRIES;
  },
  get viewsLimit() {
    return VIEWS_LIMIT;
  },
  browserEnabled: false,
});
