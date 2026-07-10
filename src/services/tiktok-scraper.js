/**
 * TikTok Scraper — Playwright Edition
 *
 * Dùng trình duyệt thật (Chromium headless) + stealth plugin
 * để bypass CAPTCHA và các cơ chế chống bot của TikTok.
 *
 * Chiến lược:
 * 1. Singleton browser: chỉ mở 1 lần, dùng lại cho mọi request
 * 2. Mỗi request = 1 BrowserContext riêng (cookies độc lập)
 * 3. Stealth plugin: vô hiệu hoá các fingerprint bot phổ biến
 * 4. Fallback axios: nếu browser chưa khởi động hoặc lỗi cold-start
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

// ── Stealth setup ──────────────────────────────────────────────────────────
chromium.use(StealthPlugin());

// ── Browser singleton ──────────────────────────────────────────────────────
let _browser = null;
let _browserStarting = false;

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',        // Render / Docker friendly
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,800',
];

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;

  // Chờ nếu đang khởi động (tránh race condition)
  if (_browserStarting) {
    await new Promise(r => setTimeout(r, 500));
    return getBrowser();
  }

  _browserStarting = true;
  try {
    console.log('[Browser] Khởi động Chromium...');
    _browser = await chromium.launch({
      headless: true,
      args: BROWSER_ARGS,
    });
    _browser.on('disconnected', () => {
      console.log('[Browser] Bị đóng, sẽ khởi động lại khi cần.');
      _browser = null;
    });
    console.log('[Browser] Chromium sẵn sàng ✓');
  } finally {
    _browserStarting = false;
  }
  return _browser;
}

// ── User-Agents ────────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
];
const randUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ── Parse dữ liệu từ JSON blob TikTok inject vào trang ────────────────────
function parseUniversalData(data) {
  if (!data) return null;

  // Path 1: __DEFAULT_SCOPE__ → webapp.user-detail
  try {
    const scope = data.__DEFAULT_SCOPE__;
    const userInfo = scope?.['webapp.user-detail']?.userInfo;
    if (userInfo) return buildProfile(userInfo.user, userInfo.stats ?? userInfo.statsV2);
  } catch { /* tiếp tục */ }

  // Path 2: UserModule (old format)
  try {
    for (const key of Object.keys(data)) {
      const mod = data[key]?.UserModule;
      if (mod?.users) {
        const uname = Object.keys(mod.users)[0];
        if (uname) return buildProfile(mod.users[uname], mod.stats?.[uname]);
      }
    }
  } catch { /* tiếp tục */ }

  return null;
}

function buildProfile(user, stats) {
  if (!user) return null;
  return {
    id: user.id || user.userId,
    secUid: user.secUid || null,          // dùng để query video list
    username: user.uniqueId || user.nickname,
    nickname: user.nickname,
    bio: user.signature,
    verified: user.verified || false,
    privateAccount: user.privateAccount || false,
    avatarUrl: user.avatarMedium || user.avatarThumb || null,
    followers: parseInt(stats?.followerCount ?? stats?.fans ?? 0),
    following: parseInt(stats?.followingCount ?? 0),
    likes: parseInt(stats?.heartCount ?? stats?.heart ?? stats?.diggCount ?? 0),
    videoCount: parseInt(stats?.videoCount ?? 0),
    totalViews: null,                     // sẽ được điền bởi fetchVideoViews()
  };
}

// ── Lấy tổng view qua browser (dùng cookies có sẵn) ─────────────────────────────────
/**
 * Dùng page.evaluate để gọi fetch() bên trong browser context.
 * Browser đã có cookies + headers hợp lệ sau khi visit profile → không bị block.
 * @param {import('playwright').Page} page
 * @param {string} secUid
 * @param {number} maxVideos
 */
async function fetchVideoViewsInBrowser(page, secUid, maxVideos = 30) {
  // Lấy URL hiện tại và cookies (có ms_token) từ browser context
  const currentUrl = page.url();
  const cookies = await page.context().cookies('https://www.tiktok.com');
  const msToken = cookies.find(c => c.name === 'msToken')?.value
    || cookies.find(c => c.name === 'ms_token')?.value
    || '';

  console.log(`[fetchVideoViewsInBrowser] cookies count=${cookies.length} | msToken=${msToken ? msToken.slice(0, 20) + '...' : 'MISSING'}`);

  const result = await page.evaluate(async ({ secUid, maxVideos, referer, msToken }) => {
    // Build base params
    const baseParams = `secUid=${encodeURIComponent(secUid)}&count=${maxVideos}&cursor=0&sourceType=8&appId=1233&region=US&priority_region=US&language=en`;
    const msTokenParam = msToken ? `&msToken=${encodeURIComponent(msToken)}` : '';

    // Thử nhiều endpoint — TikTok thay đổi API thường xuyên
    const endpoints = [
      `https://www.tiktok.com/api/post/item_list/?aid=1988&${baseParams}${msTokenParam}`,
      `https://www.tiktok.com/api/post/item_list/?${baseParams}${msTokenParam}`,
    ];

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Referer': referer,
      'Origin': 'https://www.tiktok.com',
    };

    const errors = [];
    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers, credentials: 'include' });
        const rawText = await resp.text();

        if (!resp.ok) {
          errors.push(`HTTP ${resp.status}: ${rawText.slice(0, 200)}`);
          continue;
        }

        let json;
        try { json = JSON.parse(rawText); } catch (e) {
          errors.push(`JSON parse error: ${rawText.slice(0, 200)}`);
          continue;
        }

        // TikTok trả về statusCode != 0 khi bị block / thiếu token
        if (json.statusCode !== 0 && json.statusCode !== undefined) {
          return { error: `TikTok statusCode=${json.statusCode}`, raw: JSON.stringify(json).slice(0, 400), total: null };
        }

        if (!json?.itemList || !Array.isArray(json.itemList)) {
          return { error: 'no_itemList', raw: JSON.stringify(json).slice(0, 400), total: null };
        }

        const total = json.itemList.reduce((sum, item) => {
          const plays = parseInt(
            item?.stats?.playCount ?? item?.stats?.viewCount ?? item?.statsV2?.playCount ?? 0,
            10
          );
          return sum + plays;
        }, 0);

        return { total, count: json.itemList.length };
      } catch (err) {
        errors.push(`Exception: ${err.message}`);
      }
    }

    return { error: 'all_endpoints_failed', details: errors.join(' | '), total: null };
  }, { secUid, maxVideos, referer: currentUrl, msToken });

  if (result.error) {
    console.warn('[fetchVideoViewsInBrowser] Lỗi:', result.error, result.details ?? result.raw ?? '');
    return null;
  }

  console.log(`[fetchVideoViewsInBrowser] ${result.count} videos → tổng ${result.total.toLocaleString()} views`);
  return result.total;
}

// ── Scrape bằng Playwright (primary) ──────────────────────────────────────
async function scrapeWithBrowser(username, includeViews = false) {
  const url = `https://www.tiktok.com/@${username}`;
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: randUA(),
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const page = await context.newPage();

  // Thêm stealth script thủ công để chắc chắn
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  try {
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    if (resp?.status() === 404) {
      const e = new Error(`User @${username} not found`);
      e.code = 'USER_NOT_FOUND'; e.status = 404;
      throw e;
    }

    // Chờ thêm để JS inject dữ liệu vào DOM và TikTok set cookies (ms_token cần ~3-4s)
    await page.waitForTimeout(3500);

    // Trích xuất JSON blob
    const raw = await page.evaluate(() => {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      return el ? el.textContent : null;
    });

    if (!raw) {
      // Kiểm tra có phải CAPTCHA page không
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
      console.warn('[Browser] Page text:', bodyText);
      const e = new Error('Không trích xuất được dữ liệu. Có thể TikTok đang block IP.');
      e.code = 'PARSE_ERROR'; e.status = 429;
      throw e;
    }

    const profile = parseUniversalData(JSON.parse(raw));
    if (!profile) {
      const e = new Error('Cấu trúc dữ liệu TikTok không nhận dạng được.');
      e.code = 'PARSE_ERROR'; e.status = 500;
      throw e;
    }

    // Lấy views trong cùng browser context (có cookies) nếu được yêu cầu
    console.log(`[scrapeWithBrowser] includeViews=${includeViews} | secUid=${profile.secUid} | privateAccount=${profile.privateAccount}`);
    if (includeViews && profile.secUid && !profile.privateAccount) {
      try {
        profile.totalViews = await fetchVideoViewsInBrowser(page, profile.secUid);
      } catch (viewErr) {
        console.warn('[scrapeWithBrowser] Không lấy được views:', viewErr.message);
      }
    } else if (includeViews && !profile.secUid) {
      console.warn('[scrapeWithBrowser] Bỏ qua views: secUid bị null/undefined');
    } else if (includeViews && profile.privateAccount) {
      console.warn('[scrapeWithBrowser] Bỏ qua views: tài khoản private');
    }

    return profile;
  } finally {
    await context.close();
  }
}

// ── Fallback axios (dùng nếu browser chưa warm-up) ────────────────────────
async function scrapeWithAxios(username) {
  const url = `https://www.tiktok.com/@${username}`;
  let resp;
  try {
    resp = await axios.get(url, {
      timeout: 15_000,
      headers: {
        'User-Agent': randUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      const e = new Error(`User @${username} not found`);
      e.code = 'USER_NOT_FOUND'; e.status = 404;
      throw e;
    }
    const e = new Error(`Fetch thất bại: ${err.message}`);
    e.code = 'FETCH_ERROR'; e.status = 503;
    throw e;
  }

  const html = resp.data;
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
  if (!match) {
    const e = new Error('CAPTCHA hoặc không có dữ liệu (axios fallback).');
    e.code = 'PARSE_ERROR'; e.status = 429;
    throw e;
  }

  const profile = parseUniversalData(JSON.parse(match[1]));
  if (!profile) {
    const e = new Error('Cấu trúc dữ liệu không nhận dạng được.');
    e.code = 'PARSE_ERROR'; e.status = 500;
    throw e;
  }
  return profile;
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Lấy thông tin profile TikTok user
 * Thử browser trước, nếu lỗi thử axios
 * @param {string} username
 * @returns {Promise<Object>} Profile data
 */
export async function fetchUserProfile(username, { includeViews = false } = {}) {
  const clean = username.replace(/^@/, '').trim();

  let profile;
  try {
    // Truyền includeViews vào browser để lấy views trong cùng context
    profile = await scrapeWithBrowser(clean, includeViews);
  } catch (browserErr) {
    if (browserErr.code === 'USER_NOT_FOUND') throw browserErr;
    console.warn(`[Browser] Thất bại (${browserErr.message}), thử axios fallback...`);
    // axios fallback không hỗ trợ views (không có cookies)
    profile = await scrapeWithAxios(clean);
    // Axios fallback không có cookies → không lấy được views
    // Giữ totalViews = null để client biết là chưa fetch được (khác với 0 view thật)
  }

  return profile;
}

/**
 * Warm-up browser khi server khởi động
 * Gọi hàm này 1 lần để Chromium đã sẵn sàng cho request đầu tiên
 */
export async function warmUpBrowser() {
  try {
    await getBrowser();
    console.log('[Browser] Warm-up hoàn tất.');
  } catch (err) {
    console.error('[Browser] Warm-up thất bại:', err.message);
  }
}
