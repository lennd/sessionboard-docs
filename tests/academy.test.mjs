/**
 * The Academy tab's Worker routes (src/lib/account-session.mjs) and the
 * catalog helpers behind the tab and the "Learn this in Academy" links
 * (src/lib/academy.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ACADEMY_PATH, ACADEMY_SIGN_IN_PATH, READER_COOKIE, accountResponse } from '../src/lib/account-session.mjs';
import { lessonsForArticle, visibleProducts, groupByProduct, roleOf, nextPathFor } from '../src/lib/academy.mjs';

const SITE = {
  account: {
    regions: [
      { id: 'us', api: 'https://api.example.com', app: 'https://app.example.com' },
      { id: 'eu', api: 'https://api-eu.example.com', app: 'https://app-eu.example.com' },
    ],
    signInPath: '/help-center/sign-in',
  },
};
const ORIGIN = 'https://learn.example.com';
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
const cookie = `${READER_COOKIE}=us.${TOKEN}`;

const fakeApi = (routes) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    for (const [suffix, [status, payload]] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return new Response(JSON.stringify({ success: status < 400, payload }), { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 404 });
  };
  impl.calls = calls;
  return impl;
};

const call = (path, init = {}, { api, env = {}, withCookie = true } = {}) => {
  const url = new URL(path, ORIGIN);
  const headers = new Headers(init.headers ?? {});
  if (withCookie) headers.set('Cookie', cookie);
  return accountResponse(new Request(url, { ...init, headers }), url, env, SITE, api);
};

test('GET /_account/academy reads the Academy with the reader token, never exposing it', async () => {
  const api = fakeApi({ '/help/academy': [200, { available: true, items: [{ key: 'certified-admin' }] }] });
  const res = await call(ACADEMY_PATH, {}, { api });
  assert.equal(res.status, 200);
  assert.equal(api.calls[0].url, 'https://api.example.com/help/academy');
  assert.equal(api.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  const body = await res.json();
  assert.equal(body.academy.items[0].key, 'certified-admin');
  assert.equal(body.region, 'us');
  assert.ok(!JSON.stringify(body).includes(TOKEN));
});

test('GET /_account/academy: signed out is 401; an API without the Academy reads as unavailable', async () => {
  assert.equal((await call(ACADEMY_PATH, {}, { api: fakeApi({}), withCookie: false })).status, 401);
  const res = await call(ACADEMY_PATH, {}, { api: fakeApi({}) });
  assert.deepEqual((await res.json()).academy, { available: false });
});

const signIn = (body, { origin = ORIGIN, ...opts } = {}) =>
  call(
    ACADEMY_SIGN_IN_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) },
    opts,
  );

test('POST /_account/academy/sign-in returns the Site link for page script to follow', async () => {
  const link = 'https://sites.example.com/s/sessionboard-academy/auth/handoff?token=x&next=%2Fmy';
  const api = fakeApi({ '/help/academy/sign-in': [200, { available: true, url: link }] });
  const res = await signIn({ next: '/my' }, { api });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: link, available: true });
  assert.equal(api.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(api.calls[0].init.body), { next: '/my' });
});

test('POST /_account/academy/sign-in refuses other origins and signed-out readers', async () => {
  const api = fakeApi({ '/help/academy/sign-in': [200, { url: 'https://x.example.com' }] });
  assert.equal((await signIn({}, { origin: 'https://evil.example', api })).status, 403);
  assert.equal((await signIn({}, { origin: null, api })).status, 403);
  assert.equal((await signIn({}, { api, withCookie: false })).status, 401);
  assert.equal(api.calls.length, 0);
});

test('POST /_account/academy/sign-in never hands page script a non-https link', async () => {
  const api = fakeApi({ '/help/academy/sign-in': [200, { available: true, url: 'javascript:alert(1)' }] });
  assert.equal((await (await signIn({}, { api })).json()).url, null);
  const local = fakeApi({ '/help/academy/sign-in': [200, { available: true, url: 'http://localhost:8124/s/a/auth/handoff?token=x' }] });
  assert.equal((await (await signIn({}, { api: local })).json()).url, null);
  const dev = await signIn({}, { api: local, env: { STAFF_DEV_REGIONS: 'dev=http://localhost:3001|http://localhost:8080' } });
  assert.match((await dev.json()).url, /^http:\/\/localhost:8124/);
});

// ── Catalog helpers ───────────────────────────────────────────────────

const CATALOG = {
  items: [
    {
      kind: 'certification', key: 'certified-admin', product: 'platform', released: true, tags: ['product:platform', 'role:admin'],
      courses: [{ key: 'program-essentials', lessons: [{ key: 'admin/review', title: 'Run review', help: ['/evaluations/evaluation-plans/'] }] }],
      lessons: [{ key: 'admin/final-exam', title: 'Final exam', exam: true, help: [] }],
    },
    {
      kind: 'certification', key: 'certified-reviewer', product: 'platform', released: true, tags: ['product:platform', 'role:reviewer'],
      courses: [{ key: 'reviewing', lessons: [{ key: 'reviewer/scoring', title: 'Scoring', help: ['/evaluations/evaluation-plans/'] }] }],
      lessons: [],
    },
    { kind: 'certification', key: 'certified-awards-admin', product: 'awards', released: false, tags: ['product:awards', 'role:admin'], courses: [], lessons: [] },
  ],
};

test('an article lists every lesson that teaches it, once, with its path', () => {
  const found = lessonsForArticle(CATALOG, '/evaluations/evaluation-plans');
  assert.deepEqual(found.map((l) => [l.key, l.path]), [
    ['admin/review', 'certified-admin'],
    ['reviewer/scoring', 'certified-reviewer'],
  ]);
  assert.deepEqual(lessonsForArticle(CATALOG, '/nothing/here/'), []);
  // The static build names pages /path.html.
  assert.equal(lessonsForArticle(CATALOG, '/evaluations/evaluation-plans.html').length, 2);
});

test('products: staff see all; a reader sees what they hold; Platform when unknown', () => {
  assert.deepEqual(visibleProducts({ staff: true, products: ['platform'] }), ['platform', 'marketing', 'learning', 'awards']);
  assert.deepEqual(visibleProducts({ staff: false, products: ['awards', 'platform'] }), ['platform', 'awards']);
  assert.deepEqual(visibleProducts({ staff: false, products: null }), ['platform']);
  assert.deepEqual(visibleProducts(null), ['platform']);
});

test('paths group by product in suite order, and roles read from tags', () => {
  const groups = groupByProduct(CATALOG.items);
  assert.deepEqual(groups.map((g) => [g.product, g.items.length]), [['platform', 2], ['awards', 1]]);
  assert.equal(roleOf(CATALOG.items[1]), 'reviewer');
});

test('the next step of a path: the next lesson, else the certification page', () => {
  assert.equal(nextPathFor({ kind: 'certification', id: 'c1', next_lesson_id: 'l1' }), '/lessons/l1');
  assert.equal(nextPathFor({ kind: 'certification', id: 'c1', next_lesson_id: null }), '/certifications/c1');
  assert.equal(nextPathFor({ kind: 'series', id: 's1', next_lesson_id: null }), '/courses/s1');
  assert.equal(nextPathFor(null), '/');
});
