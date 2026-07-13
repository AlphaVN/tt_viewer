import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

let app;
let server;
let baseUrl;

before(async () => {
  ({ default: app } = await import('../src/app.js'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('trusts exactly one Render proxy hop', () => {
  assert.equal(app.get('trust proxy'), 1);
});

test('accepts X-Forwarded-For without express-rate-limit proxy validation errors', async () => {
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));

  try {
    const response = await fetch(`${baseUrl}/api/not-found`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    assert.equal(response.status, 404);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(
    errors.some(message => message.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')),
    false,
  );
  assert.equal(
    errors.some(message => message.includes('ERR_ERL_PERMISSIVE_TRUST_PROXY')),
    false,
  );
});

test('keeps separate rate-limit buckets for different forwarded client IPs', async () => {
  const requestAs = ip => fetch(`${baseUrl}/api/not-found`, {
    headers: { 'X-Forwarded-For': ip },
  });

  for (let request = 0; request < 30; request += 1) {
    const response = await requestAs('203.0.113.20');
    assert.equal(response.status, 404);
  }

  const limitedResponse = await requestAs('203.0.113.20');
  assert.equal(limitedResponse.status, 429);

  const otherClientResponse = await requestAs('203.0.113.21');
  assert.equal(otherClientResponse.status, 404);
});

test('uses Render first forwarded address even when later proxy hops change', async () => {
  const requestAs = (clientIp, proxyIp) => fetch(`${baseUrl}/api/not-found`, {
    headers: { 'X-Forwarded-For': `${clientIp}, ${proxyIp}` },
  });

  for (let request = 0; request < 30; request += 1) {
    const response = await requestAs('203.0.113.30', `198.51.100.${request + 1}`);
    assert.equal(response.status, 404);
  }

  const limitedResponse = await requestAs('203.0.113.30', '198.51.100.200');
  assert.equal(limitedResponse.status, 429);

  const otherClientResponse = await requestAs('203.0.113.31', '198.51.100.200');
  assert.equal(otherClientResponse.status, 404);
});
