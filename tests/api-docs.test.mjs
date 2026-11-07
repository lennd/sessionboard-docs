// API Docs tab (/api): URL rules, 301 map coverage, sidebar and examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { guideFile, guideRoute, isApiPath, listOperations, operationIndex, rewriteHref } from '../src/lib/api-docs/urls.mjs';
import { buildApiSidebar, flatten, prevNext } from '../src/lib/api-docs/sidebar.mjs';
import { codeSamples, exampleFor, sampleRequest } from '../src/lib/api-docs/spec.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const spec = json('src/data/api/openapi.json');
const nav = json('src/data/api/nav.json');
const source = json('src/data/api/source.json');
const { redirects } = json('src/data/api/mintlify-redirects.json');

test('every operation has a unique /api/reference URL', () => {
  const ops = listOperations(spec);
  assert.ok(ops.length > 200);
  assert.equal(new Set(ops.map((o) => o.href)).size, ops.length);
  for (const o of ops) assert.match(o.href, /^\/api\/reference\/[a-z0-9-]+\/[a-z0-9-]+$/);
});

test('guide routes keep Mintlify paths under /api', () => {
  assert.equal(guideRoute('introduction'), 'api');
  assert.equal(guideRoute('guides/uploading-session-files'), 'api/guides/uploading-session-files');
  assert.equal(guideRoute('api-reference/overview'), 'api/reference/overview');
  assert.equal(guideFile('api'), 'api.mdx');
  for (const route of Object.keys(source.guides)) assert.ok(existsSync(new URL(`../src/content/docs/${guideFile(route)}`, import.meta.url)), route);
});

test('Mintlify links rewrite to Help Center URLs', () => {
  const index = operationIndex(spec);
  assert.equal(rewriteHref('/authentication#api-tokens', index), '/api/authentication#api-tokens');
  assert.equal(rewriteHref('/images/zapier.png', index), '/images/api/zapier.png');
  assert.equal(rewriteHref('https://example.com', index), null);
  const ptr = '/api-reference/openapi.yaml#/paths/~1v1~1event~1%7BeventId%7D~1sessions~1%7BsessionId%7D/get';
  assert.equal(rewriteHref(ptr, index), index.byMethodPath.get('GET /v1/event/{eventId}/sessions/{sessionId}').href);
  // Mintlify keeps "&" in some tag slugs and drops apostrophes; both resolve.
  assert.ok(rewriteHref('/api-reference/dashboards-&-widgets/list-org-dashboards-convenience', index));
  assert.ok(rewriteHref('/api-reference/contacts/get-a-contacts-sessions', index));
});

test('301 map covers every guide and endpoint and only targets pages that exist', () => {
  const ops = listOperations(spec);
  const targets = new Set(Object.values(redirects));
  // Two operations titled "Get a dashboard" share one Mintlify URL, so Mintlify serves only
  // one of them; the second gets its own page here (slug + operationId) and no redirect.
  const deduped = ops.filter((o) => o.slug !== `${o.slug.split('/')[0]}/${o.summary.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`);
  assert.ok(deduped.length <= 2, deduped.map((o) => o.href).join(' '));
  for (const o of ops) if (!deduped.includes(o)) assert.ok(targets.has(o.href), o.href);
  for (const route of Object.keys(source.guides)) assert.ok(targets.has(`/${route}`), route);
  const known = new Set([...ops.map((o) => o.href), ...Object.keys(source.guides).map((r) => `/${r}`), '/api/openapi.yaml', '/api/openapi.json']);
  for (const [from, to] of Object.entries(redirects)) assert.ok(known.has(to), `${from} -> ${to}`);
});

test('sidebar marks the current page and links prev/next', () => {
  const o = listOperations(spec)[0];
  const sidebar = buildApiSidebar({ nav, spec, source, pathname: o.href });
  const links = flatten(sidebar);
  assert.equal(links.filter((l) => l.isCurrent).length, 1);
  assert.equal(links.find((l) => l.isCurrent).href, o.href);
  const { prev, next } = prevNext(sidebar);
  assert.ok(prev || next);
  assert.ok(links.some((l) => l.href === '/api'));
  assert.equal(links.filter((l) => l.badge).length, listOperations(spec).filter((x) => JSON.stringify(nav).includes(`"${x.method.toUpperCase()} ${x.path}"`)).length);
});

test('isApiPath matches the tab only', () => {
  for (const p of ['/api', '/api/', '/api/authentication', '/api.html']) assert.ok(isApiPath(p), p);
  for (const p of ['/', '/apps/zapier', '/apis', '/integrations/api-tokens']) assert.ok(!isApiPath(p), p);
});

test('examples and code samples are generated for every operation', () => {
  for (const o of listOperations(spec)) {
    const samples = codeSamples(sampleRequest(spec, o));
    assert.deepEqual(samples.map((s) => s.label), ['cURL', 'JavaScript', 'Python', 'PHP', 'Go', 'Java']);
    assert.ok(samples[0].code.includes(o.path.split('{')[0]), o.href);
  }
  assert.deepEqual(exampleFor(spec, { type: 'object', properties: { n: { type: 'integer' } } }), { n: 123 });
});

// ── Self-serve products (src/data/api/products.json) ─────────────────────────
import { readdirSync } from 'node:fs';
import { PLATFORM, apiProductForPath, builtApiProducts, productForSourcePage, productForTab } from '../src/lib/api-docs/products.mjs';

const registry = json('src/data/api/products.json');
const productDirs = existsSync(new URL('../src/data/api/products', import.meta.url))
  ? readdirSync(new URL('../src/data/api/products', import.meta.url))
  : [];

test('unreleased products build only with SB_PREVIEW_SUITES, Platform always', () => {
  const released = Object.keys(registry.products).filter((k) => registry.products[k].released);
  assert.deepEqual([...builtApiProducts(registry, {})].sort(), released.sort());
  assert.ok(builtApiProducts(registry, {}).has(PLATFORM));
  assert.equal(builtApiProducts(registry, { SB_PREVIEW_SUITES: '1' }).size, Object.keys(registry.products).length);
  assert.deepEqual([...builtApiProducts(registry, { SB_PREVIEW_SUITES: 'awards' })].sort(), [...new Set([...released, 'awards'])].sort());
});

test('every API docs path maps to its product; other paths to none (worker sign-in landing)', () => {
  assert.equal(apiProductForPath('/api', registry), PLATFORM);
  assert.equal(apiProductForPath('/api/reference/sessions/get-a-session', registry), PLATFORM);
  assert.equal(apiProductForPath('/sessionboard-awards/api', registry), 'awards');
  assert.equal(apiProductForPath('/sessionboard-marketing/api/reference/x/y.html', registry), 'marketing');
  for (const p of ['/', '/welcome', '/sessionboard-awards/get-started', '/apis', '/integrations/api-tokens']) assert.equal(apiProductForPath(p, registry), null, p);
  assert.equal(productForTab('Awards', registry), 'awards');
  assert.equal(productForTab('API Reference', registry), PLATFORM);
  assert.equal(productForSourcePage('learning/overview', registry), 'learning');
  assert.equal(guideRoute('learning/overview', registry), 'sessionboard-learning/api');
  assert.equal(guideRoute('learning/mcp-tools', registry), 'sessionboard-learning/api/mcp-tools');
  assert.equal(guideRoute('authentication', registry), 'api/authentication');
});

for (const key of productDirs) {
  test(`${key}: its own section, never linking into Platform pages`, () => {
    const pSpec = json(`src/data/api/products/${key}/openapi.json`);
    const pNav = json(`src/data/api/products/${key}/nav.json`);
    const pSource = json(`src/data/api/products/${key}/source.json`);
    const base = registry.products[key].base;
    const ops = listOperations(pSpec, base);
    assert.ok(ops.length > 0);
    for (const o of ops) assert.ok(o.href.startsWith(`${base}/reference/`), o.href);
    const sidebar = buildApiSidebar({ nav: pNav, spec: pSpec, source: pSource, pathname: base, base, registry });
    const links = flatten(sidebar);
    assert.equal(links.find((l) => l.isCurrent)?.href, base);
    for (const l of links) assert.ok(l.href.startsWith(base), `${key} sidebar leaves its section: ${l.href}`);
    // product-docs-suites.mdc: a self-serve suite never sends its reader into Platform pages,
    // and every link inside the section reaches a page that exists (the link validator skips them).
    const routes = new Set([...Object.keys(pSource.guides).map((r) => `/${r}`), ...ops.map((o) => o.href)]);
    const dir = new URL(`../src/api-docs/${key}/`, import.meta.url);
    for (const f of readdirSync(dir)) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      for (const [, href] of text.matchAll(/\]\((\/[^)\s]*)\)|href="(\/[^"]*)"/g)) {
        if (!href || href.startsWith('/images/')) continue;
        assert.ok(href.startsWith(`${base}`), `${key}/${f} links outside its section: ${href}`);
        assert.ok(routes.has(href.split('#')[0]), `${key}/${f} links to a page that does not exist: ${href}`);
      }
    }
  });
}

test('multipart endpoints send a file part, never a JSON string', () => {
  const o = listOperations(spec).find((x) => x.method === 'post' && x.path.endsWith('/files/upload'));
  const r = sampleRequest(spec, o);
  assert.ok(r.multipart?.some((f) => f.name === 'file' && f.file));
  const [curl, js, py] = codeSamples(r);
  assert.match(curl.code, /--form 'file=@/);
  assert.doesNotMatch(curl.code, /--data/);
  assert.match(js.code, /new FormData\(\)/);
  assert.match(py.code, /files=\{"file": open\(/);
});
