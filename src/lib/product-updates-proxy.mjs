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
  } catch {
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
    const body = await readBody(request);
    const email = String(body.email ?? '').trim();
    if (!email) {
      return wantsJson(request) ? json({ ok: false, error: 'email_required' }, 400) : redirectTo(origin, { result: 'invalid' });
    }
    const api = await callApi(
      env,
      'subscribe',
      { email, website: String(body.website ?? ''), turnstileToken: body['cf-turnstile-response'] || body.turnstileToken || undefined },
      request,
      fetchImpl,
    );
    const ok = api.status >= 200 && api.status < 300;
    const result = ok ? 'check_email' : api.status === 503 ? 'unavailable' : api.status === 429 ? 'slow_down' : 'error';
    if (wantsJson(request)) return json({ ok, result }, ok ? 200 : api.status === 503 ? 503 : api.status === 429 ? 429 : 502);
    return redirectTo(origin, { result });
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
