/**
 * Staff sign-in for the Help Center — the Worker side.
 *
 * The staff-only sections (src/lib/staff-only.mjs) need to know whether the
 * reader is signed in to Sessionboard as staff. The product keeps its tokens
 * in localStorage on the app host, which this host cannot read, so the product
 * tells us instead: while a super user has web-ui-v2 open, it POSTs its access
 * token here from the browser (same site, so the cookie we answer with is a
 * first-party cookie). We check the token against that region's GET /user/me
 * and, if `is_super_user` is true, set our own signed session cookie. The
 * token itself is used once and never stored or logged.
 *
 * Routes:
 *   POST    /_staff/session   {token, api}  from an `appOrigins` page (CORS, credentials)
 *                             → 200 {staff:true, expires} + Set-Cookie, 403 {staff:false}
 *   DELETE  /_staff/session   from an `appOrigins` page → clears the cookie (product sign-out)
 *   OPTIONS /_staff/session   CORS preflight
 *   GET     /_staff/sign-in?return=/path  → 302 to the product's hand-off page
 *                             (site.json staffOnly.signInUrl), which posts and comes back
 *
 * Env: STAFF_SESSION_SECRET (secret; HMAC key for the cookie). Without it the
 * routes answer 503 and nobody is staff, so the sections stay hidden.
 * STAFF_DEV_ORIGINS / STAFF_DEV_API_ORIGINS (comma-separated, optional) add
 * origins for local testing — never set them on the production Worker.
 */

export const STAFF_PREFIX = '/_staff/';
export const SESSION_PATH = '/_staff/session';
export const SIGN_IN_PATH = '/_staff/sign-in';
/** `__Host-`: Secure, Path=/, no Domain — the cookie can only ever be this host's. */
export const COOKIE_NAME = '__Host-sb_staff';
/** The product refreshes the cookie every few hours while staff use it; this is the ceiling after they stop. */
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

const VERSION = 'v1';
const TOKEN_MAX = 8192;

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const appOrigins = (site, env) => new Set([...(site?.staffOnly?.appOrigins ?? []), ...list(env?.STAFF_DEV_ORIGINS)]);
const apiOrigins = (site, env) => new Set([...(site?.staffOnly?.apiOrigins ?? []), ...list(env?.STAFF_DEV_API_ORIGINS)]);

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

/** The verified session `{ userId, exp }`, or null when absent, expired, forged or unsigned. */
export async function verifySession(secret, value, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret || !value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, exp, userId, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) <= nowS) return null;
  if (!sameString(sig, await hmac(secret, parts.slice(0, 3).join('.')))) return null;
  return { userId, exp: Number(exp) };
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Is the reader of this request signed-in Sessionboard staff? */
export async function isStaffRequest(request, env) {
  return Boolean(await verifySession(env?.STAFF_SESSION_SECRET, readCookie(request, COOKIE_NAME)));
}

const cookie = (value, maxAge) =>
  `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

function json(status, body, origin, extra = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    Vary: 'Origin',
    ...extra,
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** A return path on this host only — never an open redirect. */
export function safeReturnPath(value) {
  const path = String(value ?? '');
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/';
}

/**
 * Answer a /_staff/ request. `fetchImpl` is injectable for tests.
 */
export async function staffResponse(request, url, env, site, fetchImpl = fetch) {
  if (url.pathname === SIGN_IN_PATH && request.method === 'GET') {
    const signIn = site?.staffOnly?.signInUrl;
    if (!signIn) return new Response('Not found\n', { status: 404 });
    // The 404 page links here without a `return`; the page it was on is the Referer.
    let ret = url.searchParams.get('return');
    if (!ret) {
      try {
        const ref = new URL(request.headers.get('Referer') ?? '');
        if (ref.origin === url.origin) ret = `${ref.pathname}${ref.search}`;
      } catch {
        // no usable Referer: back to the home page
      }
    }
    const back = `${url.origin}${safeReturnPath(ret)}`;
    const target = new URL(signIn);
    target.searchParams.set('return', back);
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } });
  }

  if (url.pathname !== SESSION_PATH) return new Response('Not found\n', { status: 404 });

  const origin = request.headers.get('Origin');
  const allowed = origin && appOrigins(site, env).has(origin) ? origin : null;
  if (!allowed) return json(403, { staff: false, error: 'origin' }, null);

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
    return json(200, { staff: false }, allowed, { 'Set-Cookie': cookie('', 0) });
  }

  if (request.method !== 'POST') return json(405, { staff: false, error: 'method' }, allowed);

  const secret = env?.STAFF_SESSION_SECRET;
  if (!secret) return json(503, { staff: false, error: 'unavailable' }, allowed);

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { staff: false, error: 'body' }, allowed);
  }
  const token = typeof body?.token === 'string' ? body.token : '';
  const api = typeof body?.api === 'string' ? body.api.replace(/\/+$/, '') : '';
  if (!token || token.length > TOKEN_MAX) return json(400, { staff: false, error: 'token' }, allowed);
  // Only our own APIs ever see the token.
  if (!apiOrigins(site, env).has(api)) return json(400, { staff: false, error: 'api' }, allowed);

  let me;
  try {
    const res = await fetchImpl(`${api}/user/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return json(403, { staff: false }, allowed);
    const data = await res.json();
    me = data?.payload ?? data;
  } catch {
    return json(502, { staff: false, error: 'upstream' }, allowed);
  }

  // Not staff (or a staff member impersonating a customer): answer no, but
  // leave any session already set alone — it expires on its own.
  if (me?.is_super_user !== true) return json(403, { staff: false }, allowed);

  const value = await signSession(secret, me.id ?? '');
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  return json(200, { staff: true, expires }, allowed, { 'Set-Cookie': cookie(value, SESSION_TTL_S) });
}
