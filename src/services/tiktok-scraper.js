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

  // Stealth script
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

    // Chờ JS render xong
    await page.waitForTimeout(2500);

    // Trích xuất JSON blob profile
    const raw = await page.evaluate(() => {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      return el ? el.textContent : null;
    });

    if (!raw) {
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

    console.log(`[scrapeWithBrowser] includeViews=${includeViews} | secUid=${profile.secUid} | privateAccount=${profile.privateAccount}`);

    if (includeViews && !profile.privateAccount) {
      try {
        profile.totalViews = await scrapeViewsFromDOM(page);
      } catch (viewErr) {
        console.warn('[scrapeWithBrowser] Không scrape được views từ DOM:', viewErr.message);
      }
    }

    return profile;
  } finally {
    await context.close();
  }
}

/**
 * Lấy tổng views từ itemList trong __UNIVERSAL_DATA_FOR_REHYDRATION__
 * TikTok nhúng một số video đầu vào đây — thử đọc sau khi trang load xong.
 */
async function scrapeViewsFromDOM(page) {
  // Chờ network idle để TikTok có thể đã fetch thêm dữ liệu
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch { /* timeout OK */ }

  // Re-read UNIVERSAL_DATA sau khi JS đã chạy thêm
  const raw = await page.evaluate(() => {
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    return el ? el.textContent : null;
  });
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    const userDetail = data?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
    const itemList = userDetail?.userInfo?.itemList;

    if (Array.isArray(itemList) && itemList.length > 0) {
      const total = itemList.reduce((sum, item) => {
        const plays = parseInt(
          item?.stats?.playCount ?? item?.stats?.viewCount ?? item?.statsV2?.playCount ?? 0,
          10
        );
        return sum + plays;
      }, 0);
      console.log(`[DOM scrape] itemList=${itemList.length} items → tổng ${total.toLocaleString()} views`);
      return total;
    }

    console.warn(`[DOM scrape] itemList rỗng (length=${itemList?.length ?? 'N/A'}) — TikTok không trả data cho headless browser`);
    return null;
  } catch (e) {
    console.warn('[DOM scrape] Parse lỗi:', e.message);
    return null;
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
