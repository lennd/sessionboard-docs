import test from 'node:test';
import assert from 'node:assert/strict';

import {
  productUpdatesResponse,
  isProductUpdatesPath,
  isValidEmail,
  normalizeEmail,
  submittedTooFast,
  MAX_CLOCK_SKEW_MS,
  MIN_FILL_MS,
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

/** What the subscribe script sends for a person: t0 at render, t1 at submit, 8 s apart. */
function human() {
  const t1 = Date.now();
  return { t0: String(t1 - 8000), t1: String(t1) };
}

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
      body: JSON.stringify({ email: 'a@b.co', website: '', ...human() }),
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

test('a personal address is told release notes go to company emails only', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ success: false, code: 'work_email_required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const res = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'pat@gmail.com', website: '', ...human() }) },
    ENV,
    fetchImpl,
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, result: 'work_email' });

  const form = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'pat@gmail.com', website: '' }).toString() },
    ENV,
    fetchImpl,
  );
  assert.equal(location(form).searchParams.get('result'), 'work_email');
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
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', ...human() }) },
    { PRODUCT_UPDATES_API_URL: 'https://api.example.com' },
    fetchImpl,
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, result: 'unavailable' });
  assert.equal(fetchImpl.calls.length, 0);
});

const postJson = (payload, headers = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

test('the address is trimmed and lowercased before it is relayed', async () => {
  const fetchImpl = fakeFetch(202, { ok: true, message: 'check_email' });
  const res = await run(SUBSCRIBE_PATH, postJson({ email: '  Josh.Parolin@Example.COM ', ...human() }), ENV, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(fetchImpl.calls[0].body.email, 'josh.parolin@example.com');
  assert.equal(normalizeEmail('  A@B.Co\n'), 'a@b.co');
});

test('a malformed address is answered "invalid" without an API call', async () => {
  for (const email of ['not an email', 'a@b', '@b.co', 'a@<b>.co', `${'x'.repeat(320)}@b.co`]) {
    const fetchImpl = fakeFetch(202, {});
    const res = await run(SUBSCRIBE_PATH, postJson({ email, ...human() }), ENV, fetchImpl);
    assert.equal(res.status, 400, email);
    assert.deepEqual(await res.json(), { ok: false, result: 'invalid' });
    assert.equal(fetchImpl.calls.length, 0, email);
  }
  assert.equal(isValidEmail('first.last+tag@sub.example.org'), true);
});

test('honeypot and too-fast submissions get the normal "check your inbox" and are never relayed', async () => {
  const bot = fakeFetch(202, {});
  const res = await run(SUBSCRIBE_PATH, postJson({ email: 'bot@example.com', website: 'http://spam' }), ENV, bot);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, result: 'check_email' });
  assert.equal(bot.calls.length, 0);

  const fast = fakeFetch(202, {});
  const resFast = await run(SUBSCRIBE_PATH, postJson({ email: 'fast@example.com', t0: String(Date.now() - 200) }), ENV, fast);
  assert.equal(resFast.status, 200);
  assert.equal(fast.calls.length, 0);

  // SB-9966 — the script always sends t0, so a JSON submit without one, with
  // t0 = t1 (instant), or with t0 after t1 is a bot: thanked, never relayed.
  const now = Date.now();
  for (const body of [
    { email: 'missing@example.com' },
    { email: 'instant@example.com', t0: String(now), t1: String(now) },
    { email: 'future@example.com', t0: String(now + 60_000), t1: String(now) },
    // SB-10408 — t0 = now with no t1 (QA's console POST) is a bot too.
    { email: 'no-t1@example.com', t0: String(now) },
  ]) {
    const botFetch = fakeFetch(202, {});
    const r = await run(SUBSCRIBE_PATH, postJson(body), ENV, botFetch);
    assert.equal(r.status, 200, body.email);
    assert.deepEqual(await r.json(), { ok: true, result: 'check_email' });
    assert.equal(botFetch.calls.length, 0, body.email);
  }

  // A person: t0 well before t1 — relayed, even when their clock runs an hour
  // ahead of the Worker's. No t0 on the no-JS form post — relayed.
  const human = fakeFetch(202, { ok: true, message: 'check_email' });
  await run(SUBSCRIBE_PATH, postJson({ email: 'human@example.com', t0: String(now - 8000), t1: String(now) }), ENV, human);
  await run(SUBSCRIBE_PATH, postJson({ email: 'ahead@example.com', t0: String(now + 3_600_000), t1: String(now + 3_608_000) }), ENV, human);
  await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=nojs%40example.com' },
    ENV,
    human
  );
  assert.equal(human.calls.length, 3);
  assert.equal('website' in human.calls[0].body && human.calls[0].body.website, '');
});

test('submittedTooFast trusts only a plausible t0', () => {
  const now = 1_800_000_000_000;
  assert.equal(submittedTooFast(String(now - 100), now), true);
  assert.equal(submittedTooFast(String(now - MIN_FILL_MS), now), false);
  assert.equal(submittedTooFast('', now), false);
  assert.equal(submittedTooFast('garbage', now), false);
  assert.equal(submittedTooFast(String(now + 5000), now), false); // clock a little ahead of ours, no t1
  assert.equal(submittedTooFast(String(now + MAX_CLOCK_SKEW_MS + 1), now), true); // t0 too far in the future
  assert.equal(submittedTooFast(String(now - 2 * 24 * 60 * 60 * 1000), now), false); // stale tab
  // SB-9966 — t1 from the same clock makes the fill time skew-proof.
  assert.equal(submittedTooFast(String(now + 3_600_000), now, { t1: String(now + 3_600_000 + 100) }), true);
  assert.equal(submittedTooFast(String(now + 3_600_000), now, { t1: String(now + 3_600_000 + 5000) }), false);
  assert.equal(submittedTooFast(String(now), now, { t1: String(now - 10) }), true); // t0 after t1
  // requireT0: the JSON submit always carries t0.
  assert.equal(submittedTooFast('', now, { requireT0: true }), true);
  assert.equal(submittedTooFast(undefined, now, { requireT0: true }), true);
  assert.equal(submittedTooFast(undefined, now), false);
  // SB-10408 — a JSON submit with t0 and no t1 is timed on our clock, strictly.
  assert.equal(submittedTooFast(String(now), now, { requireT0: true }), true);
  assert.equal(submittedTooFast(String(now + 400), now, { requireT0: true }), true);
  assert.equal(submittedTooFast(String(now + 5000), now, { requireT0: true }), true);
  assert.equal(submittedTooFast(String(now - 400), now, { requireT0: true }), true);
  assert.equal(submittedTooFast(String(now - 10_000), now, { requireT0: true }), false);
});

test('the edge rate limiter answers 429 / slow_down per visitor IP and is skipped when unbound', async () => {
  const seen = [];
  const limiter = { limit: async ({ key }) => ((seen.push(key)), { success: false }) };
  const fetchImpl = fakeFetch(202, {});
  const res = await run(
    SUBSCRIBE_PATH,
    postJson({ email: 'a@b.co', ...human() }, { 'CF-Connecting-IP': '203.0.113.9' }),
    { ...ENV, SUBSCRIBE_RATE_LIMITER: limiter },
    fetchImpl,
  );
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, result: 'slow_down' });
  assert.deepEqual(seen, ['subscribe:203.0.113.9']);
  assert.equal(fetchImpl.calls.length, 0);

  const form = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a%40b.co' },
    { ...ENV, SUBSCRIBE_RATE_LIMITER: limiter },
    fetchImpl,
  );
  assert.equal(form.status, 303);
  assert.equal(location(form).searchParams.get('result'), 'slow_down');

  const allowed = fakeFetch(202, { ok: true, message: 'check_email' });
  const ok = await run(SUBSCRIBE_PATH, postJson({ email: 'a@b.co', ...human() }), { ...ENV, SUBSCRIBE_RATE_LIMITER: { limit: async () => ({ success: true }) } }, allowed);
  assert.equal(ok.status, 200);
  assert.equal(allowed.calls.length, 1);
});

test('an API that does not have the route yet (404) reads as "unavailable", not an error', async () => {
  const res = await run(SUBSCRIBE_PATH, postJson({ email: 'a@b.co', ...human() }), ENV, fakeFetch(404, { error: 'not found' }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, result: 'unavailable' });
});

test('an unreachable API is reported as an error, not thrown', async () => {
  const res = await run(
    SUBSCRIBE_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', ...human() }) },
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
