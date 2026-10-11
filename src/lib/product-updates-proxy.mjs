/**
 * Release notes by email — the Worker side.
 *
 * The subscribe form on /help/release-notes, the confirmation link in the
 * opt-in email and the unsubscribe link in every digest all land here. The
 * Worker holds no state and makes no decision: it relays each request to
 * sessionboard-web-api (which owns the list, the consent and the sending)
 * with the shared secret, and turns the answer into a redirect to the
 * outcome page or a JSON body for the form's script.
 *
 * Routes (all under CHANGELOG_PATH = /help/release-notes):
 *   POST /subscribe            form or JSON {email, website?}  → API subscribe
 *   GET  /confirm?t=…          → API confirm → 303 /email?result=<confirmed|…>
 *   GET  /unsubscribe?t=…      → 303 /email?action=unsubscribe&t=… (a page with a button —
 *                                link scanners that GET every URL must not unsubscribe anyone)
 *   POST /unsubscribe          button or List-Unsubscribe one-click → API unsubscribe
 *
 * Env: PRODUCT_UPDATES_API_URL (var), PRODUCT_UPDATES_INTERNAL_SECRET (secret).
 * Without either, the routes answer 503 and the form shows "unavailable".
 *
 * Bot defence on /subscribe, none of it visible to a person:
 *   - the address is validated and normalised (trim + lowercase) here, so
 *     junk never reaches the API;
 *   - `website` is a honeypot (hidden field, bots fill it) and `t0` is the
 *     time the form rendered — a submit under MIN_FILL_MS later is a script.
 *     Both are answered with the same "check your inbox" as a real request,
 *     so the bot learns nothing; nothing is relayed;
 *   - SUBSCRIBE_RATE_LIMITER (Workers Rate Limiting binding, per visitor IP)
 *     answers 429 / "slow_down" past a handful of attempts a minute;
 *   - the form sends an invisible Turnstile token when the widget loaded
 *     (site key in ReleaseNotesSubscribe.astro), which web-api verifies. No token
 *     is still accepted — the API's own per-address and per-IP throttles and
 *     the double opt-in are the backstop — so an ad blocker costs nothing.
 */

export const SUBSCRIBE_PATH = '/help/release-notes/subscribe';
export const CONFIRM_PATH = '/help/release-notes/confirm';
export const UNSUBSCRIBE_PATH = '/help/release-notes/unsubscribe';
export const STATUS_PATH = '/help/release-notes/email';

const API_ROUTES = {
  subscribe: '/community/public/product-updates/subscribe',
  confirm: '/community/public/product-updates/confirm',
  unsubscribe: '/community/public/product-updates/unsubscribe',
};

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
// Same shape web-api accepts (lib/community/product-updates.js); anything
// else is answered "invalid" without an API call.
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const EMAIL_MAX = 320;
/** A form filled in under this many ms after render was not filled by a person. */
export const MIN_FILL_MS = 1500;
/** `t0` older than this is ignored (a tab left open, a clock skew) rather than trusted. */
const MAX_T0_AGE_MS = 24 * 60 * 60 * 1000;

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
export const isValidEmail = (email) => EMAIL_RE.test(email) && email.length <= EMAIL_MAX;

/**
 * True when `t0` (ms since epoch, set by the form's script when the card
 * rendered) says the submit came too fast for a person. Missing or
 * nonsensical values do not count against the visitor: the no-JS form has no
 * t0 at all.
 */
export const submittedTooFast = (t0, now = Date.now()) => {
  const start = Number(t0);
  if (!Number.isFinite(start) || start <= 0) return false;
  const elapsed = now - start;
  if (elapsed < 0 || elapsed > MAX_T0_AGE_MS) return false;
  return elapsed < MIN_FILL_MS;
};

/**
 * Per-visitor edge throttle via the Workers Rate Limiting binding. Returns
 * true when the request may proceed; with no binding (local dev, tests) or a
 * binding error it lets the request through — the API throttles too.
 *
 * Cloudflare keeps these counters per server inside a colo and syncs nothing,
 * so a handful of requests fanned across machines never trips it; it is the
 * flood brake. The accurate per-visitor limit (20/h) lives in web-api and
 * comes back as 429 → "slow_down" through the same path.
 */
async function withinRateLimit(env, request) {
  const limiter = env?.SUBSCRIBE_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `subscribe:${ip}` });
    return success !== false;
  } catch (err) {
    console.warn('subscribe rate limiter failed open:', err?.message ?? err);
    return true;
  }
}

export const isProductUpdatesPath = (pathname) =>
  pathname === SUBSCRIBE_PATH || pathname === CONFIRM_PATH || pathname === UNSUBSCRIBE_PATH;

const wantsJson = (request) => {
  const accept = request.headers.get('Accept') ?? '';
  const type = request.headers.get('Content-Type') ?? '';
  return accept.includes('application/json') || type.includes('application/json');
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

const redirectTo = (origin, params) => {
  const url = new URL(STATUS_PATH, origin);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { Location: url.toString(), 'Cache-Control': 'no-store' } });
};

async function readBody(request) {
  const type = request.headers.get('Content-Type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = await request.json();
      return body && typeof body === 'object' ? body : {};
    }
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return {};
  }
}

/**
 * Call the API. Returns { status, body } and never throws: a network failure
 * is reported as status 0 so callers can show "try again later".
 */
async function callApi(env, route, payload, request, fetchImpl) {
  const base = String(env.PRODUCT_UPDATES_API_URL ?? '').replace(/\/+$/, '');
  const secret = env.PRODUCT_UPDATES_INTERNAL_SECRET;
  if (!base || !secret) return { status: 503, body: { error: 'not configured' } };
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Internal-Service': 'docs',
    'X-Internal-Secret': secret,
  };
  const visitorIp = request.headers.get('CF-Connecting-IP');
  if (visitorIp) headers['X-Visitor-Ip'] = visitorIp;
  const ua = request.headers.get('User-Agent');
  if (ua) headers['X-Visitor-User-Agent'] = ua.slice(0, 512);
  try {
    const res = await fetchImpl(`${base}${API_ROUTES[route]}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return { status: res.status, body: body?.payload ?? body };
  } catch (err) {
    console.warn('subscribe upstream unreachable:', err?.message ?? err);
    return { status: 0, body: { error: 'unreachable' } };
  }
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {{PRODUCT_UPDATES_API_URL?: string, PRODUCT_UPDATES_INTERNAL_SECRET?: string}} env
 * @param {typeof fetch} [fetchImpl]
 */
export async function productUpdatesResponse(request, url, env, fetchImpl = fetch) {
  const origin = url.origin;
  const method = request.method.toUpperCase();

  if (url.pathname === SUBSCRIBE_PATH) {
    if (method !== 'POST') return redirectTo(origin, {});
    const asJson = wantsJson(request);
    const answer = (ok, result, status) => (asJson ? json({ ok, result }, status) : redirectTo(origin, { result }));

    if (!(await withinRateLimit(env, request))) return answer(false, 'slow_down', 429);

    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    if (!email) return asJson ? json({ ok: false, error: 'email_required' }, 400) : redirectTo(origin, { result: 'invalid' });
    if (!isValidEmail(email)) return answer(false, 'invalid', 400);

    // Honeypot filled or filled in faster than a person types: say thanks,
    // relay nothing. The address is never stored.
    if (String(body.website ?? '').trim() || submittedTooFast(body.t0)) return answer(true, 'check_email', 200);

    const api = await callApi(
      env,
      'subscribe',
      { email, website: '', turnstileToken: body['cf-turnstile-response'] || body.turnstileToken || undefined },
      request,
      fetchImpl,
    );
    const ok = api.status >= 200 && api.status < 300;
    // 404: the API build in front of us predates the route — the list is not
    // open yet, which is "unavailable", not an error on our side.
    const unavailable = api.status === 503 || api.status === 404;
    const result = ok ? 'check_email' : unavailable ? 'unavailable' : api.status === 429 ? 'slow_down' : 'error';
    return answer(ok, result, ok ? 200 : unavailable ? 503 : api.status === 429 ? 429 : 502);
  }

  if (url.pathname === CONFIRM_PATH) {
    const token = url.searchParams.get('t') ?? '';
    if (!TOKEN_RE.test(token)) return redirectTo(origin, { result: 'invalid' });
    const api = await callApi(env, 'confirm', { token }, request, fetchImpl);
    if (api.status === 503) return redirectTo(origin, { result: 'unavailable' });
    if (!(api.status >= 200 && api.status < 300)) return redirectTo(origin, { result: 'error' });
    return redirectTo(origin, { result: api.body?.result || 'error' });
  }

  if (url.pathname === UNSUBSCRIBE_PATH) {
    if (method === 'GET' || method === 'HEAD') {
      const token = url.searchParams.get('t') ?? '';
      if (!TOKEN_RE.test(token)) return redirectTo(origin, { result: 'invalid' });
      // Show the page with the button; the POST below does the work.
      return redirectTo(origin, { action: 'unsubscribe', t: token });
    }
    if (method !== 'POST') return redirectTo(origin, {});
    const body = await readBody(request);
    const token = String(body.t ?? body.token ?? url.searchParams.get('t') ?? '').trim();
    if (!TOKEN_RE.test(token)) {
      return wantsJson(request) ? json({ ok: false, result: 'invalid' }, 400) : redirectTo(origin, { result: 'invalid' });
    }
    const api = await callApi(env, 'unsubscribe', { token }, request, fetchImpl);
    const ok = api.status >= 200 && api.status < 300;
    const result = ok ? api.body?.result || 'error' : api.status === 503 ? 'unavailable' : 'error';
    // RFC 8058 one-click posts `List-Unsubscribe=One-Click` and wants a 2xx,
    // not a redirect to a page nobody will see.
    const oneClick = (request.headers.get('Content-Type') ?? '').includes('application/x-www-form-urlencoded') && body['List-Unsubscribe'] === 'One-Click';
    if (oneClick || wantsJson(request)) return json({ ok, result }, ok ? 200 : 502);
    return redirectTo(origin, { result });
  }

  return null;
}
