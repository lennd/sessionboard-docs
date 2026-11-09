// apidocs.sessionboard.com (retired Mintlify site) -> /api on the Help Center.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retiredApiDocsTarget } from '../src/lib/api-docs/retired-host.mjs';

const { redirects } = JSON.parse(readFileSync(new URL('../src/data/api/mintlify-redirects.json', import.meta.url), 'utf8'));
const site = JSON.parse(readFileSync(new URL('../site.json', import.meta.url), 'utf8'));
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('every Mintlify page lands on its /api page', () => {
  assert.equal(retiredApiDocsTarget('/', redirects), '/api');
  assert.equal(retiredApiDocsTarget('/introduction', redirects), '/api');
  assert.equal(retiredApiDocsTarget('/authentication/', redirects), '/api/authentication');
  assert.equal(retiredApiDocsTarget('/changelog', redirects), '/api/changelog');
  assert.equal(retiredApiDocsTarget('/breaking-changes', redirects), '/api/breaking-changes');
  assert.equal(retiredApiDocsTarget('/api-reference/openapi.json', redirects), '/api/openapi.json');
  for (const [from, to] of Object.entries(redirects)) assert.equal(retiredApiDocsTarget(from, redirects), to, from);
});

test('Mintlify spellings: .md pages, encoded "&", llms.txt, unknown paths', () => {
  assert.equal(retiredApiDocsTarget('/webhooks.md', redirects), '/api/webhooks');
  const amp = Object.keys(redirects).find((k) => k.includes('&'));
  assert.ok(amp);
  assert.equal(retiredApiDocsTarget(amp.replace('&', '%26'), redirects), redirects[amp]);
  assert.equal(retiredApiDocsTarget('/llms-full.txt', redirects), '/api/llms.txt');
  assert.equal(retiredApiDocsTarget('/no-such-page', redirects), '/api');
  assert.equal(retiredApiDocsTarget('/%E0%A4%A', redirects), '/api');
});

test('the host is routed to this Worker without a Custom Domain (DNS untouched)', () => {
  assert.deepEqual(site.retiredApiDocsHosts, ['apidocs.sessionboard.com']);
  assert.match(wrangler, /pattern = "apidocs\.sessionboard\.com\/\*"\nzone_name = "sessionboard\.com"/);
});
