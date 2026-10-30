import test from 'node:test';
import assert from 'node:assert/strict';

import { isStaffOnlyHref, isStaffOnlyPath, isStaffOnlySlug, staffOnlyGlobs } from '../src/lib/staff-only.mjs';
import {
  COOKIE_NAME,
  SESSION_PATH,
  SESSION_TTL_S,
  SIGN_IN_PATH,
  isStaffRequest,
  safeReturnPath,
  signSession,
  staffResponse,
  verifySession,
} from '../src/lib/staff-session.mjs';
import realSite from '../site.json' with { type: 'json' };

const SITE = {
  canonicalHost: 'learn.example.com',
  legacyHosts: ['help.example.com'],
  staffOnly: {
    prefixes: ['registration', 'onsite'],
    pages: ['participants/register-for-an-event'],
    appOrigins: ['https://app.example.com'],
    apiOrigins: ['https://api.example.com'],
    signInUrl: 'https://app.example.com/help-center/staff-sign-in',
  },
};
const ORIGIN = 'https://learn.example.com';
const ENV = { STAFF_SESSION_SECRET: 'test-secret' };
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';

// ── Which pages ────────────────────────────────────────────────────────

test('slugs: prefixes cover the section index and everything under it, pages match exactly', () => {
  assert.equal(isStaffOnlySlug('registration', SITE), true);
  assert.equal(isStaffOnlySlug('/registration/overview', SITE), true);
  assert.equal(isStaffOnlySlug('onsite/kiosk.html', SITE), true);
  assert.equal(isStaffOnlySlug('participants/register-for-an-event', SITE), true);
  assert.equal(isStaffOnlySlug('participants/attend-app', SITE), false);
  assert.equal(isStaffOnlySlug('registration-tips', SITE), false, 'a prefix is a path segment, not a string prefix');
  assert.equal(isStaffOnlySlug('field-events/registration-form', SITE), false);
  assert.equal(isStaffOnlySlug('', SITE), false);
  assert.equal(isStaffOnlySlug('registration/overview', {}), false, 'no rule, nothing gated');
});

test('paths: the page, its trailing-slash form and its share card', () => {
  assert.equal(isStaffOnlyPath('/registration/overview/', SITE), true);
  assert.equal(isStaffOnlyPath('/og/registration--overview.png', SITE), true);
  assert.equal(isStaffOnlyPath('/og/participants--register-for-an-event.png', SITE), true);
  assert.equal(isStaffOnlyPath('/og/attend--overview.png', SITE), false);
  assert.equal(isStaffOnlyPath('/pagefind/pagefind.js', SITE), false);
});

test('hrefs: root-relative and same-site absolute links, with hashes and queries', () => {
  assert.equal(isStaffOnlyHref('/onsite/web-desk', SITE), true);
  assert.equal(isStaffOnlyHref('/registration/integrations-and-api#registrations-held', SITE), true);
  assert.equal(isStaffOnlyHref('https://learn.example.com/registration/overview', SITE), true);
  assert.equal(isStaffOnlyHref('https://help.example.com/onsite', SITE), true);
  assert.equal(isStaffOnlyHref('https://other.example.com/registration', SITE), false);
  assert.equal(isStaffOnlyHref('#registration', SITE), false);
  assert.equal(isStaffOnlyHref('registration/overview', SITE), false);
  assert.equal(isStaffOnlyHref('/attend', SITE), false);
});

test('llms globs list each section and page', () => {
  assert.deepEqual(staffOnlyGlobs(SITE), [
    'registration',
    'registration/**',
    'onsite',
    'onsite/**',
    'participants/register-for-an-event',
  ]);
});

test('site.json gates Registration, Expo and Onsite', () => {
  for (const slug of ['registration/overview', 'expo/floor-plan', 'onsite/kiosk']) {
    assert.equal(isStaffOnlySlug(slug, realSite), true, slug);
  }
  assert.equal(isStaffOnlySlug('attend/overview', realSite), false);
  assert.ok(realSite.staffOnly.apiOrigins.every((o) => o.startsWith('https://')));
});

// ── Session cookie ────────────────────────────────────────────────────

test('a signed session verifies, and fails once expired, re-signed or tampered', async () => {
  const now = 1_800_000_000;
  const value = await signSession('k', 'user-1', now);
  assert.deepEqual(await verifySession('k', value, now + 10), { userId: 'user-1', exp: now + SESSION_TTL_S });
  assert.equal(await verifySession('k', value, now + SESSION_TTL_S + 1), null, 'expired');
  assert.equal(await verifySession('other', value, now), null, 'different secret');
  const [v, exp, uid, sig] = value.split('.');
  assert.equal(await verifySession('k', [v, String(Number(exp) + 999999), uid, sig].join('.'), now), null, 'extended');
  assert.equal(await verifySession('k', [v, exp, 'user-2', sig].join('.'), now), null, 'swapped user');
  assert.equal(await verifySession('', value, now), null, 'no secret, nobody is staff');
  assert.equal(await verifySession('k', 'garbage', now), null);
});

test('isStaffRequest reads only the named cookie', async () => {
  const value = await signSession(ENV.STAFF_SESSION_SECRET, 'u1');
  const req = (cookie) => new Request(`${ORIGIN}/`, { headers: { Cookie: cookie } });
  assert.equal(await isStaffRequest(req(`a=1; ${COOKIE_NAME}=${value}; b=2`), ENV), true);
  assert.equal(await isStaffRequest(req(`x${COOKIE_NAME}=${value}`), ENV), false);
  assert.equal(await isStaffRequest(req(''), ENV), false);
  assert.equal(await isStaffRequest(req(`${COOKIE_NAME}=${value}`), {}), false);
});

// ── /_staff/session ───────────────────────────────────────────────────

const fakeMe = (status, payload) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: status < 400, payload }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  impl.calls = calls;
  return impl;
};

const post = (body, { origin = 'https://app.example.com', env = ENV, me = fakeMe(200, { id: 'u1', is_super_user: true }) } = {}) => {
  const url = new URL(SESSION_PATH, ORIGIN);
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return staffResponse(request, url, env, SITE, me).then((res) => ({ res, me }));
};

test('a super user gets a session cookie the Worker then accepts', async () => {
  const { res, me } = await post({ token: TOKEN, api: 'https://api.example.com/' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).staff, true);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.example.com');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(me.calls[0].url, 'https://api.example.com/user/me');
  assert.equal(me.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);

  const setCookie = res.headers.get('Set-Cookie');
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=v1\\.`));
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_TTL_S}`]) {
    assert.ok(setCookie.includes(attr), attr);
  }
  const cookie = setCookie.split(';')[0];
  assert.equal(await isStaffRequest(new Request(`${ORIGIN}/`, { headers: { Cookie: cookie } }), ENV), true);
});

test('a customer (or staff impersonating one) is refused and gets no cookie', async () => {
  const { res } = await post({ token: TOKEN, api: 'https://api.example.com' }, { me: fakeMe(200, { id: 'u2', is_super_user: false }) });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('a token the API rejects is refused', async () => {
  const { res } = await post({ token: TOKEN, api: 'https://api.example.com' }, { me: fakeMe(401, null) });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('the token is never sent to an API outside the allowlist', async () => {
  const { res, me } = await post({ token: TOKEN, api: 'https://evil.example.net' });
  assert.equal(res.status, 400);
  assert.equal(me.calls.length, 0);
});

test('a page outside appOrigins cannot sign anyone in, and gets no CORS grant', async () => {
  for (const origin of ['https://evil.example.net', null]) {
    const { res, me } = await post({ token: TOKEN, api: 'https://api.example.com' }, { origin });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(me.calls.length, 0);
  }
});

test('dev origins come from env only', async () => {
  const env = { ...ENV, STAFF_DEV_ORIGINS: 'http://localhost:8080', STAFF_DEV_API_ORIGINS: 'http://localhost:3001' };
  const { res } = await post({ token: TOKEN, api: 'http://localhost:3001' }, { origin: 'http://localhost:8080', env });
  assert.equal(res.status, 200);
});

test('without the secret the route is unavailable and nobody is signed in', async () => {
  const { res, me } = await post({ token: TOKEN, api: 'https://api.example.com' }, { env: {} });
  assert.equal(res.status, 503);
  assert.equal(me.calls.length, 0);
});

test('DELETE clears the cookie; OPTIONS answers the preflight', async () => {
  const url = new URL(SESSION_PATH, ORIGIN);
  const del = await staffResponse(new Request(url, { method: 'DELETE', headers: { Origin: 'https://app.example.com' } }), url, ENV, SITE);
  assert.equal(del.status, 200);
  assert.match(del.headers.get('Set-Cookie'), /Max-Age=0/);

  const pre = await staffResponse(new Request(url, { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } }), url, ENV, SITE);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
});

// ── /_staff/sign-in ───────────────────────────────────────────────────

test('sign-in sends the reader to the product hand-off with a same-host return URL', async () => {
  const url = new URL(`${SIGN_IN_PATH}?return=/registration/overview`, ORIGIN);
  const res = await staffResponse(new Request(url), url, ENV, SITE);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, SITE.staffOnly.signInUrl);
  assert.equal(to.searchParams.get('return'), `${ORIGIN}/registration/overview`);
});

test('sign-in falls back to the same-host Referer, and never to another host', async () => {
  const url = new URL(SIGN_IN_PATH, ORIGIN);
  const from = (referer) =>
    staffResponse(new Request(url, { headers: { Referer: referer } }), url, ENV, SITE).then((r) =>
      new URL(r.headers.get('Location')).searchParams.get('return'),
    );
  assert.equal(await from(`${ORIGIN}/onsite/kiosk?x=1`), `${ORIGIN}/onsite/kiosk?x=1`);
  assert.equal(await from('https://evil.example.net/phish'), `${ORIGIN}/`);
});

test('return paths cannot leave the host', () => {
  assert.equal(safeReturnPath('/onsite'), '/onsite');
  assert.equal(safeReturnPath('//evil.example.net'), '/');
  assert.equal(safeReturnPath('/\\evil.example.net'), '/');
  assert.equal(safeReturnPath('https://evil.example.net'), '/');
  assert.equal(safeReturnPath(null), '/');
});
