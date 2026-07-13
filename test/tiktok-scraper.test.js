import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';

let server;
let baseUrl;
let fetchUserProfile;
let getUserProfileInfo;
let scraperConfig;

const profiles = {
  demo: {
    user: {
      id: '123',
      secUid: 'sec-123',
      uniqueId: 'demo',
      nickname: 'Demo',
      signature: 'Test profile',
      verified: true,
      privateAccount: false,
      avatarMedium: 'https://example.com/avatar.jpg',
    },
    stats: {
      followerCount: 100,
      followingCount: 5,
      heartCount: 300,
      videoCount: 2,
    },
  },
  private_demo: {
    user: {
      id: '456',
      uniqueId: 'private_demo',
      nickname: 'Private Demo',
      privateAccount: true,
    },
    stats: {
      followerCount: 10,
      followingCount: 1,
      heartCount: 20,
      videoCount: 3,
    },
  },
  exact_demo: {
    user: {
      id: '789',
      uniqueId: 'exact_demo',
      nickname: 'Exact Demo',
      privateAccount: false,
    },
    stats: {
      followerCount: 100,
      followingCount: 5,
      heartCount: 300,
      videoCount: 2,
    },
    statsV2: {
      followerCount: '123',
      heartCount: '345',
      videoCount: '2',
    },
  },
};

function profileHtml(userInfo, { format = 'universal', statusCode = 0, statusMsg = '' } = {}) {
  const data = format === 'next'
    ? {
        props: {
          pageProps: {
            userInfo,
            statusCode,
            statusMsg,
          },
        },
      }
    : {
        __DEFAULT_SCOPE__: {
          'webapp.user-detail': {
            userInfo,
            statusCode,
            statusMsg,
          },
        },
      };
  const id = format === 'next' ? '__NEXT_DATA__' : '__UNIVERSAL_DATA_FOR_REHYDRATION__';
  return `<!doctype html><script nonce="test-nonce" id='${id}' type="application/json">${JSON.stringify(data)}</script>`;
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const username = url.searchParams.get('unique_id');

    if (url.pathname.startsWith('/@')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const profileUsername = decodeURIComponent(url.pathname.slice(2));

      if (profileUsername === 'missing_user') {
        res.end(profileHtml(null, { statusCode: 10221, statusMsg: 'user banned' }));
        return;
      }

      if (profileUsername === 'missing_code_only') {
        res.end(profileHtml(null, { statusCode: 10221 }));
        return;
      }

      if (profileUsername === 'legacy_demo') {
        res.end(profileHtml(profiles.demo, { format: 'next' }));
        return;
      }

      if (profileUsername === 'provider_fallback') {
        res.statusCode = 503;
        res.end('temporarily unavailable');
        return;
      }

      if (profileUsername === 'html_404_provider_ok') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      if (profileUsername === 'incomplete_html_provider_ok') {
        res.end(profileHtml({ user: profiles.demo.user }));
        return;
      }

      if (profileUsername === 'all_sources_incomplete') {
        res.end(profileHtml({ user: profiles.demo.user }));
        return;
      }

      const profile = profiles[profileUsername];
      if (profile) {
        res.end(profileHtml(profile));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/api/user/info') {
      if (['provider_fallback', 'html_404_provider_ok', 'incomplete_html_provider_ok'].includes(username)) {
        res.end(JSON.stringify({ code: 0, msg: 'success', data: profiles.demo }));
        return;
      }
      if (username === 'all_sources_incomplete') {
        res.end(JSON.stringify({
          code: 0,
          msg: 'success',
          data: { user: profiles.demo.user, stats: { followerCount: 100 } },
        }));
        return;
      }
      if (!profiles[username]) {
        res.end(JSON.stringify({ code: -1, msg: 'unique_id is invalid' }));
        return;
      }
      res.end(JSON.stringify({ code: 0, msg: 'success', data: profiles[username] }));
      return;
    }

    if (url.pathname === '/api/user/posts' && username === 'demo') {
      res.end(JSON.stringify({
        code: 0,
        msg: 'success',
        data: {
          videos: [
            { video_id: 'v1', play_count: 1_250, create_time: 1_700_000_000 },
            { video_id: 'v2', play_count: 2_750, create_time: 1_600_000_000 },
          ],
          hasMore: false,
          cursor: '0',
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ code: -1, msg: 'not found' }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.TIKTOK_HTTP_API_URL = baseUrl;
  process.env.TIKTOK_WEB_URL = baseUrl;
  process.env.TIKTOK_REQUEST_INTERVAL_MS = '250';
  process.env.TIKTOK_HTTP_RETRIES = '1';
  process.env.TIKTOK_VIEWS_LIMIT = '30';

  ({ fetchUserProfile, getUserProfileInfo, scraperConfig } = await import('../src/services/tiktok-scraper.js'));
});

after(async () => {
  delete process.env.TIKTOK_HTTP_API_URL;
  delete process.env.TIKTOK_WEB_URL;
  delete process.env.TIKTOK_REQUEST_INTERVAL_MS;
  delete process.env.TIKTOK_HTTP_RETRIES;
  delete process.env.TIKTOK_VIEWS_LIMIT;
  await new Promise(resolve => server.close(resolve));
});

test('runs in HTTP-only mode', () => {
  assert.equal(scraperConfig.browserEnabled, false);
  assert.equal(scraperConfig.providerUrl, baseUrl);
  assert.equal(scraperConfig.tiktokWebUrl, baseUrl);
  assert.equal(scraperConfig.profileStrategy, 'tiktok-html-with-provider-fallback');
});

test('getUserProfileInfo returns raw metadata from current universal data', async () => {
  const userInfo = await getUserProfileInfo('@demo');

  assert.equal(userInfo.user.uniqueId, 'demo');
  assert.equal(userInfo.stats.followerCount, 100);
});

test('prefers exact statsV2 counts over rounded profile stats', async () => {
  const userInfo = await getUserProfileInfo('exact_demo');
  const profile = await fetchUserProfile('exact_demo');

  assert.equal(userInfo.stats.followerCount, 123);
  assert.equal(userInfo.stats.followingCount, 5);
  assert.equal(userInfo.stats.heartCount, 345);
  assert.equal(profile.followers, 123);
  assert.equal(profile.following, 5);
  assert.equal(profile.likes, 345);
});

test('getUserProfileInfo remains compatible with upstream legacy __NEXT_DATA__', async () => {
  const userInfo = await getUserProfileInfo('legacy_demo');

  assert.equal(userInfo.user.uniqueId, 'demo');
  assert.equal(userInfo.stats.heartCount, 300);
});

test('getUserProfileInfo validates an empty username before making a request', async () => {
  await assert.rejects(
    getUserProfileInfo(' @ '),
    error => error.code === 'INVALID_USERNAME' && error.status === 400,
  );
});

test('maps TikTok missing-user status codes even when statusMsg is empty', async () => {
  await assert.rejects(
    getUserProfileInfo('missing_code_only'),
    error => error.code === 'USER_NOT_FOUND' && error.status === 404,
  );
});

test('uses provider profile as fallback when TikTok HTML is unavailable', async () => {
  const profile = await fetchUserProfile('provider_fallback');

  assert.equal(profile.username, 'demo');
  assert.equal(profile.followers, 100);
  assert.equal(profile.dataSource, 'tikwm');
});

test('does not trust a TikTok HTTP 404 when the provider still resolves the user', async () => {
  const profile = await fetchUserProfile('html_404_provider_ok');

  assert.equal(profile.username, 'demo');
  assert.equal(profile.dataSource, 'tikwm');
});

test('does not turn incomplete TikTok stats into zero metrics', async () => {
  await assert.rejects(
    getUserProfileInfo('incomplete_html_provider_ok'),
    error => error.code === 'INVALID_TIKTOK_DATA' && error.status === 502,
  );

  const profile = await fetchUserProfile('incomplete_html_provider_ok');
  assert.equal(profile.followers, 100);
  assert.equal(profile.likes, 300);
  assert.equal(profile.videoCount, 2);
  assert.equal(profile.dataSource, 'tikwm');
});

test('rejects incomplete provider stats instead of returning plausible zero metrics', async () => {
  await assert.rejects(
    fetchUserProfile('all_sources_incomplete'),
    error => error.code === 'INVALID_PROVIDER_DATA' && error.status === 502,
  );
});

test('sums recent video views and returns account health', async () => {
  const profile = await fetchUserProfile('demo', { includeViews: true });

  assert.equal(profile.totalViews, 4_000);
  assert.equal(profile.viewsVideoCount, 2);
  assert.equal(profile.viewsScope, 'recent_public_videos');
  assert.equal(profile.accountHealth.status, 'ACTIVE');
  assert.equal(profile.accountHealth.canReadViews, true);
  assert.equal(profile.accountHealth.lastVideoAt, '2023-11-14T22:13:20.000Z');
});

test('does not claim views were checked on a profile-only request', async () => {
  const profile = await fetchUserProfile('demo');

  assert.equal(profile.dataSource, 'tiktok-universal-data');
  assert.equal(profile.totalViews, null);
  assert.equal(profile.viewsScope, 'not_requested');
  assert.equal(profile.accountHealth.status, 'ACTIVE');
  assert.equal(profile.accountHealth.canReadViews, null);
});

test('reports private accounts without inventing a view count', async () => {
  const profile = await fetchUserProfile('private_demo', { includeViews: true });

  assert.equal(profile.totalViews, null);
  assert.equal(profile.viewsScope, 'unavailable_private_account');
  assert.equal(profile.accountHealth.status, 'ACTIVE_PRIVATE');
  assert.equal(profile.accountHealth.canReadViews, false);
});

test('returns structured health details for a missing account', async () => {
  await assert.rejects(
    fetchUserProfile('missing_user'),
    error => error.code === 'USER_NOT_FOUND'
      && error.status === 404
      && error.details.accountHealth.status === 'NOT_FOUND',
  );
});
