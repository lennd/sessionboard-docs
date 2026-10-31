import test from 'node:test';
import assert from 'node:assert/strict';

import { isStaffOnlyHref, isStaffOnlyPath, isStaffOnlySlug, staffOnlyGlobs } from '../src/lib/staff-only.mjs';
import {
  CONTEXT_PATH,
  HINT_COOKIE,
  ME_PATH,
  READER_COOKIE,
  SESSION_COOKIE,
  SESSION_PATH,
  SESSION_TTL_S,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  STAFF_COOKIE,
  accountResponse,
  isSignedInRequest,
  isStaffRequest,
  readReader,
  safeReturnPath,
  signSession,
  verifySession,
} from '../src/lib/account-session.mjs';
import realSite from '../site.json' with { type: 'json' };

const SITE = {
  canonicalHost: 'learn.example.com',
  legacyHosts: ['help.example.com'],
  staffOnly: {
    prefixes: ['registration', 'onsite'],
    pages: ['participants/register-for-an-event'],
  },
  account: {
    regions: [
      { id: 'us', api: 'https://api.example.com', app: 'https://app.example.com' },
      { id: 'eu', api: 'https://api-eu.example.com', app: 'https://app-eu.example.com' },
    ],
    signInPath: '/help-center/sign-in',
  },
};
const ORIGIN = 'https://learn.example.com';
const ENV = { STAFF_SESSION_SECRET: 'test-secret' };
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
const ADMIN_TOKEN = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBC';

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

test('site.json gates Registration, Expo, Onsite, the Attend app and Enablement to staff', () => {
  for (const slug of ['registration/overview', 'expo/floor-plan', 'onsite/kiosk', 'attend/overview', 'attend', 'participants/attend-app', 'enablement/releases/x']) {
    assert.equal(isStaffOnlySlug(slug, realSite), true, slug);
  }
  assert.equal(isStaffOnlySlug('sessions/accept-decline', realSite), false);
  assert.equal(isStaffOnlySlug('attendees/overview', realSite), false, 'a prefix is a whole segment');
  assert.ok(realSite.account.regions.every((r) => r.api.startsWith('https://') && r.app.startsWith('https://')));
});

// ── Staff cookie ──────────────────────────────────────────────────────

test('a signed staff session verifies, and fails once expired, re-signed or tampered', async () => {
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
  assert.equal(await isStaffRequest(req(`a=1; ${STAFF_COOKIE}=${value}; b=2`), ENV), true);
  assert.equal(await isStaffRequest(req(`x${STAFF_COOKIE}=${value}`), ENV), false);
  assert.equal(await isStaffRequest(req(''), ENV), false);
  assert.equal(await isStaffRequest(req(`${STAFF_COOKIE}=${value}`), {}), false);
});

// ── A fake region API ─────────────────────────────────────────────────

const READER = {
  id: 'u1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.test',
  photo_url: null,
  staff: true,
  token_scope: 'help_reader',
  signed_in_via: 'portal',
  roles: ['speaker', 'organizer'],
  organizations: [],
  portals: [{ event_id: 5, event_name: 'Summit', org_name: 'Acme' }],
};

/** /help/reader/me answers per token; /help/events/:id/context echoes the id. */
const fakeApi = ({ reader = READER, status = 200 } = {}) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const auth = init?.headers?.Authorization;
    const send = (code, payload) =>
      new Response(JSON.stringify({ success: code < 400, payload }), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/help/reader/me')) {
      if (status !== 200) return send(status, null);
      if (auth === `Bearer ${ADMIN_TOKEN}`) return send(200, { ...reader, token_scope: 'admin' });
      return send(200, reader);
    }
    const ev = url.match(/\/help\/events\/(\d+)\/context$/);
    if (ev) return send(200, { context: { event_id: Number(ev[1]) } });
    return send(404, null);
  };
  impl.calls = calls;
  return impl;
};

const call = (path, init = {}, { env = ENV, api = fakeApi(), cookie } = {}) => {
  const url = new URL(path, ORIGIN);
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set('Cookie', cookie);
  return accountResponse(new Request(url, { ...init, headers }), url, env, SITE, api).then((res) => ({ res, api }));
};

const post = (body, { origin = 'https://app.example.com', ...opts } = {}) =>
  call(
    SESSION_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    },
    opts,
  );

const cookieJar = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ');

// ── /_account/session ─────────────────────────────────────────────────

test('a reader token signs the reader in: reader + hint cookies, and staff when they are staff', async () => {
  const { res, api } = await post({ token: TOKEN, api: 'https://api.example.com/' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedIn: true, staff: true });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.example.com');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(api.calls[0].url, 'https://api.example.com/help/reader/me');
  assert.equal(api.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);

  const set = res.headers.getSetCookie();
  const reader = set.find((c) => c.startsWith(`${READER_COOKIE}=`));
  assert.ok(reader.startsWith(`${READER_COOKIE}=us.${TOKEN};`));
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_TTL_S}`]) assert.ok(reader.includes(attr), attr);
  const hint = set.find((c) => c.startsWith(`${HINT_COOKIE}=`));
  assert.ok(hint.startsWith(`${HINT_COOKIE}=1;`) && !hint.includes('HttpOnly'), 'page script can see the hint');

  const jar = cookieJar(res);
  assert.equal(await isSignedInRequest(new Request(`${ORIGIN}/`, { headers: { Cookie: jar } }), ENV), true, 'the sign-in gate opens');
  assert.equal(await isStaffRequest(new Request(`${ORIGIN}/`, { headers: { Cookie: jar } }), ENV), true);
  assert.equal(readReader(new Request(`${ORIGIN}/`, { headers: { Cookie: jar } }), SITE, ENV).token, TOKEN);
});

test('a reader who is not staff gets no staff cookie (and any old one is cleared)', async () => {
  const { res } = await post({ token: TOKEN, api: 'https://api-eu.example.com' }, { api: fakeApi({ reader: { ...READER, staff: false } }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedIn: true, staff: false });
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${STAFF_COOKIE}=;`)).includes('Max-Age=0'));
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${READER_COOKIE}=eu.`)), 'the region is recorded');
});

test('an admin access token is never kept', async () => {
  const { res } = await post({ token: ADMIN_TOKEN, api: 'https://api.example.com' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'scope');
  assert.deepEqual(res.headers.getSetCookie(), []);
});

test('a token the API rejects is refused', async () => {
  const { res } = await post({ token: TOKEN, api: 'https://api.example.com' }, { api: fakeApi({ status: 401 }) });
  assert.equal(res.status, 403);
  assert.deepEqual(res.headers.getSetCookie(), []);
});

test('the token is never sent to an API outside the regions', async () => {
  const { res, api } = await post({ token: TOKEN, api: 'https://evil.example.net' });
  assert.equal(res.status, 400);
  assert.equal(api.calls.length, 0);
});

test('a page outside the app origins cannot sign anyone in, and gets no CORS grant', async () => {
  for (const origin of ['https://evil.example.net', null]) {
    const { res, api } = await post({ token: TOKEN, api: 'https://api.example.com' }, { origin });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(api.calls.length, 0);
  }
});

test('local regions come from env only', async () => {
  const env = { ...ENV, STAFF_DEV_REGIONS: 'dev=http://localhost:3001|http://localhost:8080' };
  const { res } = await post({ token: TOKEN, api: 'http://localhost:3001' }, { origin: 'http://localhost:8080', env });
  assert.equal(res.status, 200);
});

test('without the secret nobody passes the sign-in gate or is staff (fail closed)', async () => {
  const { res } = await post({ token: TOKEN, api: 'https://api.example.com' }, { env: {} });
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${STAFF_COOKIE}=;`)));
  assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=v1`)));
  assert.equal(await isSignedInRequest(new Request(`${ORIGIN}/`, { headers: { Cookie: cookieJar(res) } }), {}), false);
});

test('a forged or missing gate cookie does not sign anyone in', async () => {
  const req = (cookie) => new Request(`${ORIGIN}/`, { headers: { Cookie: cookie } });
  assert.equal(await isSignedInRequest(req(''), ENV), false);
  assert.equal(await isSignedInRequest(req(`${SESSION_COOKIE}=v1.9999999999.u1.AAAA`), ENV), false);
  assert.equal(await isSignedInRequest(req(`${HINT_COOKIE}=1`), ENV), false, 'the readable hint is not a session');
});

test('/me re-issues the gate cookie for a good reader session that lacks it (sessions from before the gate)', async () => {
  const jar = cookieJar((await post({ token: TOKEN, api: 'https://api.example.com' })).res)
    .split('; ')
    .filter((c) => !c.startsWith(`${SESSION_COOKIE}=`))
    .join('; ');
  const { res } = await call(ME_PATH, {}, { cookie: jar });
  assert.equal(res.status, 200);
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=v1.`)));
});

test('DELETE from the product clears all three cookies; OPTIONS answers the preflight', async () => {
  const { res: del } = await call(SESSION_PATH, { method: 'DELETE', headers: { Origin: 'https://app.example.com' } });
  assert.equal(del.status, 200);
  const cleared = del.headers.getSetCookie();
  for (const name of [READER_COOKIE, SESSION_COOKIE, STAFF_COOKIE, HINT_COOKIE]) {
    assert.ok(cleared.find((c) => c.startsWith(`${name}=;`) && c.includes('Max-Age=0')), name);
  }
  const { res: pre } = await call(SESSION_PATH, { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
});

// ── /_account/me, /_account/context, /_account/sign-out ───────────────

const signedIn = async () => cookieJar((await post({ token: TOKEN, api: 'https://api.example.com' })).res);

test('/me returns the reader without the token, with where to link them in the product', async () => {
  const cookie = await signedIn();
  const { res } = await call(ME_PATH, {}, { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.reader.first_name, 'Ada');
  assert.equal(body.reader.signed_in_via, 'portal');
  assert.deepEqual(body.reader.roles, ['speaker', 'organizer']);
  assert.equal(body.reader.app_origin, 'https://app.example.com');
  assert.ok(!JSON.stringify(body).includes(TOKEN), 'the token never reaches page script');
});

test('/me when the API no longer accepts the token ends the session', async () => {
  const cookie = await signedIn();
  const { res } = await call(ME_PATH, {}, { cookie, api: fakeApi({ status: 401 }) });
  assert.equal(res.status, 401);
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${READER_COOKIE}=;`)));
});

test('/me drops the staff cookie as soon as the reader is no longer staff', async () => {
  const cookie = await signedIn();
  const { res } = await call(ME_PATH, {}, { cookie, api: fakeApi({ reader: { ...READER, staff: false } }) });
  assert.equal(res.status, 200);
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${STAFF_COOKIE}=;`)));
});

test('/me signed out is a plain 401 with no API call', async () => {
  const { res, api } = await call(ME_PATH);
  assert.equal(res.status, 401);
  assert.equal(api.calls.length, 0);
});

test('/context proxies one event or org, and validates the id', async () => {
  const cookie = await signedIn();
  const { res } = await call(`${CONTEXT_PATH}?eventId=77`, {}, { cookie });
  assert.deepEqual(await res.json(), { context: { event_id: 77 } });
  for (const q of ['eventId=0', 'eventId=1/../../user/me', 'orgId=nope', '']) {
    const { res: bad, api } = await call(`${CONTEXT_PATH}?${q}`, {}, { cookie });
    assert.equal(bad.status, 400, q);
    assert.equal(api.calls.length, 0, q);
  }
});

test('sign-out from a Help Center page clears the session; a cross-site form cannot', async () => {
  const { res } = await call(SIGN_OUT_PATH, { method: 'POST', headers: { Origin: ORIGIN } });
  assert.equal(res.status, 200);
  assert.ok(res.headers.getSetCookie().find((c) => c.startsWith(`${READER_COOKIE}=;`)));
  const { res: csrf } = await call(SIGN_OUT_PATH, { method: 'POST', headers: { Origin: 'https://evil.example.net' } });
  assert.equal(csrf.status, 403);
});

// ── /_account/sign-in ─────────────────────────────────────────────────

test('sign-in goes through the chosen region\'s app', async () => {
  const { res } = await call(`${SIGN_IN_PATH}?region=eu&return=/sessions`);
  assert.equal(new URL(res.headers.get('Location')).origin, 'https://app-eu.example.com');
  const { res: unknown } = await call(`${SIGN_IN_PATH}?region=mars`);
  assert.equal(new URL(unknown.headers.get('Location')).origin, 'https://app.example.com');
});

test('sign-in sends the reader to the product hand-off with a same-host return URL', async () => {
  const { res } = await call(`${SIGN_IN_PATH}?return=/registration/overview`);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://app.example.com/help-center/sign-in');
  assert.equal(to.searchParams.get('return'), `${ORIGIN}/registration/overview`);
});

test('sign-in falls back to the same-host Referer, and never to another host', async () => {
  const from = (referer) =>
    call(SIGN_IN_PATH, { headers: { Referer: referer } }).then(({ res }) => new URL(res.headers.get('Location')).searchParams.get('return'));
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
