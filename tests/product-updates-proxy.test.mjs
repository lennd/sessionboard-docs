import test from 'node:test';
import assert from 'node:assert/strict';

import {
  productUpdatesResponse,
  isProductUpdatesPath,
  SUBSCRIBE_PATH,
  CONFIRM_PATH,
  UNSUBSCRIBE_PATH,
  STATUS_PATH,
} from '../src/lib/product-updates-proxy.mjs';

const ORIGIN = 'https://learn.example.com';
const ENV = { PRODUCT_UPDATES_API_URL: 'https://api.example.com/', PRODUCT_UPDATES_INTERNAL_SECRET: 'shh' };
const TOKEN = 'abcDEF123_-abcDEF123_-xyz';

const fakeFetch = (status, payload) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ payload }), { status, headers: { 'Content-Type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
};

const run = (path, init = {}, env = ENV, fetchImpl = fakeFetch(200, { ok: true, message: 'check_email' })) => {
  const url = new URL(path, ORIGIN);
  const request = new Request(url, init);
  return productUpdatesResponse(request, url, env, fetchImpl);
};

const location = (res) => new URL(res.headers.get('Location'));

test('recognises exactly its three paths', () => {
  assert.equal(isProductUpdatesPath(SUBSCRIBE_PATH), true);
  assert.equal(isProductUpdatesPath(CONFIRM_PATH), true);
  assert.equal(isProductUpdatesPath(UNSUBSCRIBE_PATH), true);
  assert.equal(isProductUpdatesPath('/help/release-notes'), false);
  assert.equal(isProductUpdatesPath(STATUS_PATH), false);
});

test('subscribe relays the address with the shared secret and the visitor IP, JSON in → JSON out', async () => {
  const fetchImpl = fakeFetch(202, { ok: true, message: 'check_email' });
  const res = await run(
    SUBSCRIBE_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'UA' },
      body: JSON.stringify({ email: 'a@b.co', website: '' }),
    },
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, result: 'check_email' });
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init, body }] = fetchImpl.calls;
  assert.equal(url, 'https://api.example.com/community/public/product-updates/subscribe');
  assert.equal(init.headers['X-Internal-Service'], 'docs');
  assert.equal(init.headers['X-Internal-Secret'], 'shh');
  assert.equal(init.headers['X-Visitor-Ip'], '203.0.113.9');
  assert.equal(init.headers['X-Visitor-User-Agent'], 'UA');
  assert.deepEqual(body, { email: 'a@b.co', website: '' });
});

test('subscribe from a plain form redirects to the outcome page', async () => {
  const form = new URLSearchParams({ email: 'a@b.co', website: '' });
  const res = await run(SUBSCRIBE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  assert.equal(res.status, 303);
  const loc = location(res);
  assert.equal(loc.pathname, STATUS_PATH);
  assert.equal(loc.searchParams.get('result'), 'check_email');
});

test('subscribe without an address is rejected before any API call', async () => {
  const fetchImpl = fakeFetch(202, {});
  const res = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 400);
  assert.equal(fetchImpl.calls.length, 0);
});

test('503 from a missing secret surfaces as "unavailable" and never calls the API', async () => {
  const fetchImpl = fakeFetch(202, {});
  const res = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co' }) },
    { PRODUCT_UPDATES_API_URL: 'https://api.example.com' },
    fetchImpl,
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, result: 'unavailable' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('an unreachable API is reported as an error, not thrown', async () => {
  const res = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co' }) },
    ENV,
    async () => {
      throw new Error('ECONNRESET');
    },
  );
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { ok: false, result: 'error' });
});

test('confirm posts the token and redirects with the API result', async () => {
  const fetchImpl = fakeFetch(200, { result: 'confirmed' });
  const res = await run(`${CONFIRM_PATH}?t=${TOKEN}`, {}, ENV, fetchImpl);
  assert.equal(res.status, 303);
  assert.equal(location(res).searchParams.get('result'), 'confirmed');
  assert.deepEqual(fetchImpl.calls[0].body, { token: TOKEN });
  assert.equal(fetchImpl.calls[0].url, 'https://api.example.com/community/public/product-updates/confirm');
});

test('confirm with a malformed token never reaches the API', async () => {
  const fetchImpl = fakeFetch(200, { result: 'confirmed' });
  const res = await run(`${CONFIRM_PATH}?t=<script>`, {}, ENV, fetchImpl);
  assert.equal(location(res).searchParams.get('result'), 'invalid');
  assert.equal(fetchImpl.calls.length, 0);
});

test('GET unsubscribe shows the confirmation page instead of acting (link scanners)', async () => {
  const fetchImpl = fakeFetch(200, { result: 'unsubscribed' });
  const res = await run(`${UNSUBSCRIBE_PATH}?t=${TOKEN}`, {}, ENV, fetchImpl);
  assert.equal(res.status, 303);
  const loc = location(res);
  assert.equal(loc.pathname, STATUS_PATH);
  assert.equal(loc.searchParams.get('action'), 'unsubscribe');
  assert.equal(loc.searchParams.get('t'), TOKEN);
  assert.equal(fetchImpl.calls.length, 0);
});

test('POST unsubscribe from the page button acts and redirects', async () => {
  const fetchImpl = fakeFetch(200, { result: 'unsubscribed' });
  const res = await run(
    UNSUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t: TOKEN }).toString() },
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 303);
  assert.equal(location(res).searchParams.get('result'), 'unsubscribed');
  assert.deepEqual(fetchImpl.calls[0].body, { token: TOKEN });
});

test('RFC 8058 one-click unsubscribe gets a 200, not a redirect', async () => {
  const fetchImpl = fakeFetch(200, { result: 'unsubscribed' });
  const res = await run(
    `${UNSUBSCRIBE_PATH}?t=${TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mail-Provider/1.0' },
      body: 'List-Unsubscribe=One-Click',
    },
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, result: 'unsubscribed' });
  assert.deepEqual(fetchImpl.calls[0].body, { token: TOKEN });
});

test('other paths are not handled', async () => {
  assert.equal(await run('/help/release-notes'), null);
});
