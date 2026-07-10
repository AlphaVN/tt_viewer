import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';

let server;
let baseUrl;
let fetchUserProfile;
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
};

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const username = url.searchParams.get('unique_id');
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/api/user/info') {
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
  process.env.TIKTOK_REQUEST_INTERVAL_MS = '250';
  process.env.TIKTOK_HTTP_RETRIES = '1';
  process.env.TIKTOK_VIEWS_LIMIT = '30';

  ({ fetchUserProfile, scraperConfig } = await import('../src/services/tiktok-scraper.js'));
});

after(async () => {
  delete process.env.TIKTOK_HTTP_API_URL;
  delete process.env.TIKTOK_REQUEST_INTERVAL_MS;
  delete process.env.TIKTOK_HTTP_RETRIES;
  delete process.env.TIKTOK_VIEWS_LIMIT;
  await new Promise(resolve => server.close(resolve));
});

test('runs in HTTP-only mode', () => {
  assert.equal(scraperConfig.browserEnabled, false);
  assert.equal(scraperConfig.providerUrl, baseUrl);
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
