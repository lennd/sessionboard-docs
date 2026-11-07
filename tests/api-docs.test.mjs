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
