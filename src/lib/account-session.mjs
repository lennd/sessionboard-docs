/**
 * Signed-in readers — the Worker side.
 *
 * The Help Center shows who is reading: their name in the header, where they
 * signed in from (admin app, speaker portal, Ready Room), the roles they hold,
 * an org / event picker that personalizes articles, and — for Sessionboard
 * staff — the staff-only sections (src/lib/staff-only.mjs).
 *
 * The product keeps its tokens in localStorage on the app host, which this host
 * cannot read, so the product hands us one. It mints a read-only Help Center
 * token from its region's API (web-api `POST /help/reader-token`, scope
 * `help_reader`: it can read only GET /help/reader/me and
 * /help/{events,orgs}/:id/context) and POSTs it here from the browser — same
 * site, so our cookies are first-party. We check it against /help/reader/me and
 * keep it in an HttpOnly cookie; page scripts then read through the routes
 * below and never see the token. We refuse to keep anything but a reader token,
 * so an admin access token is never stored here.
 *
 * Routes:
 *   POST    /_account/session  {token, api}  from a region's app origin (CORS, credentials)
 *                              → 200 {signedIn, staff} + cookies; 403 when the API refuses it
 *   DELETE  /_account/session  from a region's app origin → signed out (product sign-out)
 *   OPTIONS /_account/session  CORS preflight
 *   GET     /_account/me       the reader (no-store); 401 when signed out
 *   GET     /_account/context?eventId=|orgId=  personalization context for one of their scopes
 *   POST    /_account/sign-out from a Help Center page → signed out
 *   GET     /_account/sign-in?return=/path  → 302 to the product's hand-off page
 *   GET     /_account/guest?t=<link>&return=/path  a signed guest link (scripts/guest-link.mjs)
 *                              → 302 with a plain session cookie: signed in, never staff, no reader
 *
 * Cookies: READER_COOKIE (HttpOnly; `<region id>.<reader token>`),
 * SESSION_COOKIE (HttpOnly; HMAC-signed with STAFF_SESSION_SECRET — the Help
 * Center is sign-in only, and this is what worker.js checks on every request
 * without an API call), STAFF_COOKIE (same, for the staff-only sections) and
 * HINT_COOKIE (readable by page script; only says "a session exists").
 *
 * Env: STAFF_SESSION_SECRET (secret). Without it nobody is signed in, so the
 * whole Help Center stays behind the landing page (fail closed).
 * GUEST_LINK_SECRET (secret, separate on purpose): signs guest links for
 * people outside Sessionboard who are given read access by hand — a partner
 * product lead, say. A guest link opens the customer Help Center only: it
 * never sets the staff cookie, so the staff-only sections stay hidden, and it
 * sets no reader cookie, so the header shows no account. Rotating the secret
 * revokes every link. Without the secret, /_account/guest is a 404. STAFF_DEV_ORIGINS / STAFF_DEV_REGIONS add local origins for
 * testing (`STAFF_DEV_REGIONS=dev=http://localhost:3001|http://localhost:8080`) —
 * never set them on the production Worker.
 */

export const ACCOUNT_PREFIX = '/_account/';
export const SESSION_PATH = '/_account/session';
export const ME_PATH = '/_account/me';
export const CONTEXT_PATH = '/_account/context';
export const SIGN_IN_PATH = '/_account/sign-in';
export const SIGN_OUT_PATH = '/_account/sign-out';
export const GUEST_PATH = '/_account/guest';
/** How long a guest link itself stays valid; each visit mints a SESSION_TTL_S cookie. */
export const GUEST_LINK_TTL_S = 180 * 24 * 60 * 60;

/** `__Host-`: Secure, Path=/, no Domain — only ever this host's. */
export const READER_COOKIE = '__Host-sb_reader';
export const SESSION_COOKIE = '__Host-sb_session';
export const STAFF_COOKIE = '__Host-sb_staff';
export const HINT_COOKIE = 'sb_signed_in';
/** Matches the reader token's lifetime; the product refreshes both while it is in use. */
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

const VERSION = 'v1';
const TOKEN_MAX = 8192;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimOrigin = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/** Configured regions plus any local ones from env: `[{ id, api, app }]`. */
export function regions(site, env) {
  const configured = (site?.account?.regions ?? []).map((r) => ({
    id: r.id,
    api: trimOrigin(r.api),
    app: trimOrigin(r.app),
  }));
  const dev = String(env?.STAFF_DEV_REGIONS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, rest = ''] = entry.split('=');
      const [api, app] = rest.split('|');
      return { id: id.trim(), api: trimOrigin(api), app: trimOrigin(app) };
    })
    .filter((r) => r.id && r.api && r.app);
  return [...configured, ...dev];
}

const appOrigins = (site, env) =>
  new Set([
    ...regions(site, env).map((r) => r.app),
    ...String(env?.STAFF_DEV_ORIGINS ?? '')
      .split(',')
      .map(trimOrigin)
      .filter(Boolean),
  ]);

// ── Staff cookie (HMAC) ──────────────────────────────────────────────────

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** Branch-free string compare (both sides are fixed-width HMAC digests). */
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `v1.<exp seconds>.<user id>.<hmac>` */
export async function signSession(secret, userId, nowS = Math.floor(Date.now() / 1000)) {
  const body = `${VERSION}.${nowS + SESSION_TTL_S}.${String(userId).replace(/[^A-Za-z0-9_-]/g, '')}`;
  return `${body}.${await hmac(secret, body)}`;
}

/** The verified staff session `{ userId, exp }`, or null when absent, expired, forged or unsigned. */
export async function verifySession(secret, value, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret || !value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, exp, userId, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) <= nowS) return null;
  if (!sameString(sig, await hmac(secret, parts.slice(0, 3).join('.')))) return null;
  return { userId, exp: Number(exp) };
}

const GUEST_VERSION = 'g1';
const guestLabel = (label) => String(label ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/** A guest link token `g1.<exp seconds>.<label>.<hmac>`, signed with GUEST_LINK_SECRET (never the session secret). */
export async function signGuestLink(secret, label, ttlS = GUEST_LINK_TTL_S, nowS = Math.floor(Date.now() / 1000)) {
  const name = guestLabel(label);
  if (!secret || !name) throw new Error('guest link needs a secret and a label');
  const body = `${GUEST_VERSION}.${nowS + ttlS}.${name}`;
  return `${body}.${await hmac(secret, body)}`;
}

/** The verified guest link `{ label, exp }`, or null when absent, expired, forged, unsigned or not a guest token. */
export async function verifyGuestLink(secret, value, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret || !value) return null;
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts[0] !== GUEST_VERSION) return null;
  const [, exp, label, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) <= nowS) return null;
  if (!label || label !== guestLabel(label)) return null;
  if (!sameString(sig, await hmac(secret, parts.slice(0, 3).join('.')))) return null;
  return { label, exp: Number(exp) };
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Is the reader of this request signed in to the Help Center (any Sessionboard user)? */
export async function isSignedInRequest(request, env) {
  return Boolean(await verifySession(env?.STAFF_SESSION_SECRET, readCookie(request, SESSION_COOKIE)));
}

/** Is the reader of this request signed-in Sessionboard staff? */
export async function isStaffRequest(request, env) {
  return Boolean(await verifySession(env?.STAFF_SESSION_SECRET, readCookie(request, STAFF_COOKIE)));
}

// ── Reader cookie ────────────────────────────────────────────────────────

/** `{ region, token }` from the reader cookie, or null. The region must still be configured. */
export function readReader(request, site, env) {
  const value = readCookie(request, READER_COOKIE);
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const region = regions(site, env).find((r) => r.id === value.slice(0, dot));
  const token = value.slice(dot + 1);
  if (!region || !token || token.length > TOKEN_MAX) return null;
  return { region, token };
}

const setCookie = (name, value, maxAge, { httpOnly = true } = {}) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; ${httpOnly ? 'HttpOnly; ' : ''}Secure; SameSite=Lax`;

/** Set-Cookie headers that end every part of the session. */
export const clearSessionCookies = () => [
  setCookie(READER_COOKIE, '', 0),
  setCookie(SESSION_COOKIE, '', 0),
  setCookie(STAFF_COOKIE, '', 0),
  setCookie(HINT_COOKIE, '', 0, { httpOnly: false }),
];

function json(status, body, { origin = null, cookies = [] } = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
    Vary: 'Origin, Cookie',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** A return path on this host only — never an open redirect. */
export function safeReturnPath(value) {
  const path = String(value ?? '');
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/';
}

/** GET {api}/help/reader/me with a reader token: the payload, or null with the HTTP status. */
async function fetchReader(region, token, fetchImpl) {
  const res = await fetchImpl(`${region.api}/help/reader/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return { status: res.status, reader: null };
  const data = await res.json();
  return { status: 200, reader: data?.payload ?? data };
}

/** What page script gets: the reader, where to link them in the product, and nothing token-shaped. */
function publicReader(reader, region) {
  return {
    id: reader.id,
    first_name: reader.first_name ?? null,
    last_name: reader.last_name ?? null,
    email: reader.email ?? null,
    photo_url: reader.photo_url ?? null,
    staff: reader.staff === true,
    signed_in_via: reader.signed_in_via ?? 'admin',
    roles: Array.isArray(reader.roles) ? reader.roles : [],
    organizations: Array.isArray(reader.organizations) ? reader.organizations : [],
    portals: Array.isArray(reader.portals) ? reader.portals : [],
    region: region.id,
    app_origin: region.app,
  };
}

/** Cookies for a verified reader: the session, the hint, and the staff flag kept in step. */
async function sessionCookies(region, token, reader, env) {
  const cookies = [
    setCookie(READER_COOKIE, `${region.id}.${token}`, SESSION_TTL_S),
    setCookie(HINT_COOKIE, '1', SESSION_TTL_S, { httpOnly: false }),
  ];
  const secret = env?.STAFF_SESSION_SECRET;
  if (secret) cookies.push(setCookie(SESSION_COOKIE, await signSession(secret, reader.id ?? ''), SESSION_TTL_S));
  if (reader.staff === true && secret) {
    cookies.push(setCookie(STAFF_COOKIE, await signSession(secret, reader.id ?? ''), SESSION_TTL_S));
  } else {
    cookies.push(setCookie(STAFF_COOKIE, '', 0));
  }
  return cookies;
}

/**
 * Answer a /_account/ request. `fetchImpl` is injectable for tests.
 */
export async function accountResponse(request, url, env, site, fetchImpl = fetch) {
  const { pathname } = url;

  if (pathname === SIGN_IN_PATH && request.method === 'GET') {
    // `?region=eu` signs in through that region's app; the US app otherwise.
    const all = regions(site, env);
    const home = all.find((r) => r.id === url.searchParams.get('region')) ?? all[0];
    const signInPath = site?.account?.signInPath;
    if (!home || !signInPath) return new Response('Not found\n', { status: 404 });
    // The 404 page and the header link here without a `return`; the page they were on is the Referer.
    let ret = url.searchParams.get('return');
    if (!ret) {
      try {
        const ref = new URL(request.headers.get('Referer') ?? '');
        if (ref.origin === url.origin) ret = `${ref.pathname}${ref.search}`;
      } catch {
        // no usable Referer: back to the home page
      }
    }
    const target = new URL(signInPath, home.app);
    target.searchParams.set('return', `${url.origin}${safeReturnPath(ret)}`);
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } });
  }

  if (pathname === GUEST_PATH && request.method === 'GET') {
    // A guest link: the customer Help Center for someone outside Sessionboard,
    // by hand. Only the sign-in gate cookie is set — no staff cookie (the
    // staff-only sections stay hidden), no reader cookie and no hint cookie
    // (page scripts treat the visit as signed out and call no API). A bad or
    // expired link is the same 404 as an unknown path; nothing says it exists.
    const link = await verifyGuestLink(env?.GUEST_LINK_SECRET, url.searchParams.get('t'));
    const secret = env?.STAFF_SESSION_SECRET;
    if (!link || !secret) return new Response('Not found\n', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const cookies = [
      setCookie(SESSION_COOKIE, await signSession(secret, `guest-${link.label}`), SESSION_TTL_S),
      setCookie(STAFF_COOKIE, '', 0),
      setCookie(READER_COOKIE, '', 0),
      setCookie(HINT_COOKIE, '', 0, { httpOnly: false }),
    ];
    const headers = new Headers({
      Location: safeReturnPath(url.searchParams.get('return')),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      Vary: 'Cookie',
    });
    for (const c of cookies) headers.append('Set-Cookie', c);
    return new Response(null, { status: 302, headers });
  }

  if (pathname === SIGN_OUT_PATH) {
    // Same-origin page script only: a cross-site form must not sign anyone out.
    if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) {
      return json(403, { signedIn: false, error: 'origin' });
    }
    return json(200, { signedIn: false }, { cookies: clearSessionCookies() });
  }

  if (pathname === ME_PATH && request.method === 'GET') {
    const session = readReader(request, site, env);
    if (!session) return json(401, { signedIn: false }, { cookies: readCookie(request, HINT_COOKIE) ? clearSessionCookies() : [] });
    let result;
    try {
      result = await fetchReader(session.region, session.token, fetchImpl);
    } catch {
      return json(502, { signedIn: true, error: 'upstream' });
    }
    // Expired, revoked or a deleted user: end the session here too.
    if (result.status === 401 || result.status === 403) {
      return json(401, { signedIn: false }, { cookies: clearSessionCookies() });
    }
    if (!result.reader) return json(502, { signedIn: true, error: 'upstream' });
    // Re-sync the staff flag on every read, so losing super-user status hides
    // the staff sections at the next page load rather than when the cookie ends.
    const staffCookie = await isStaffRequest(request, env);
    const cookies = [];
    // Keep the sign-in gate in step with the reader session (e.g. after a deploy
    // that first introduced it, or a cleared cookie).
    if (env?.STAFF_SESSION_SECRET && !(await isSignedInRequest(request, env))) {
      cookies.push(setCookie(SESSION_COOKIE, await signSession(env.STAFF_SESSION_SECRET, result.reader.id ?? ''), SESSION_TTL_S));
    }
    if (result.reader.staff !== true && staffCookie) cookies.push(setCookie(STAFF_COOKIE, '', 0));
    if (result.reader.staff === true && !staffCookie && env?.STAFF_SESSION_SECRET) {
      cookies.push(setCookie(STAFF_COOKIE, await signSession(env.STAFF_SESSION_SECRET, result.reader.id ?? ''), SESSION_TTL_S));
    }
    return json(200, { signedIn: true, reader: publicReader(result.reader, session.region) }, { cookies });
  }

  if (pathname === CONTEXT_PATH && request.method === 'GET') {
    const session = readReader(request, site, env);
    if (!session) return json(401, { signedIn: false });
    const eventId = url.searchParams.get('eventId');
    const orgId = url.searchParams.get('orgId');
    let path;
    if (eventId && /^[1-9]\d{0,9}$/.test(eventId)) path = `/help/events/${eventId}/context`;
    else if (orgId && UUID_RE.test(orgId)) path = `/help/orgs/${orgId}/context`;
    else return json(400, { error: 'scope' });
    try {
      const res = await fetchImpl(`${session.region.api}${path}`, {
        headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
      });
      if (!res.ok) return json(res.status === 401 ? 401 : 403, { context: null });
      const data = await res.json();
      return json(200, { context: (data?.payload ?? data)?.context ?? null });
    } catch {
      return json(502, { context: null, error: 'upstream' });
    }
  }

  if (pathname !== SESSION_PATH) return new Response('Not found\n', { status: 404 });

  const origin = request.headers.get('Origin');
  const allowed = origin && appOrigins(site, env).has(origin) ? origin : null;
  if (!allowed) return json(403, { signedIn: false, error: 'origin' });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    });
  }

  if (request.method === 'DELETE') {
    return json(200, { signedIn: false }, { origin: allowed, cookies: clearSessionCookies() });
  }

  if (request.method !== 'POST') return json(405, { signedIn: false, error: 'method' }, { origin: allowed });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { signedIn: false, error: 'body' }, { origin: allowed });
  }
  const token = typeof body?.token === 'string' ? body.token : '';
  const api = trimOrigin(typeof body?.api === 'string' ? body.api : '');
  if (!token || token.length > TOKEN_MAX) return json(400, { signedIn: false, error: 'token' }, { origin: allowed });
  // Only our own APIs ever see the token.
  const region = regions(site, env).find((r) => r.api === api);
  if (!region) return json(400, { signedIn: false, error: 'api' }, { origin: allowed });

  let result;
  try {
    result = await fetchReader(region, token, fetchImpl);
  } catch {
    return json(502, { signedIn: false, error: 'upstream' }, { origin: allowed });
  }
  if (!result.reader) return json(403, { signedIn: false }, { origin: allowed });
  // Never keep an admin (or any other) token: only the read-only reader scope.
  if (result.reader.token_scope !== 'help_reader') {
    return json(400, { signedIn: false, error: 'scope' }, { origin: allowed });
  }

  return json(
    200,
    { signedIn: true, staff: result.reader.staff === true },
    { origin: allowed, cookies: await sessionCookies(region, token, result.reader, env) },
  );
}
