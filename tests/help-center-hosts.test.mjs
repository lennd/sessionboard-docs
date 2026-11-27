import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import site from '../site.json' with { type: 'json' };
import { ga4LinkerDomains } from '../src/lib/ga4.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('support.sessionboard.com is a legacy host, bound like help', () => {
  assert.deepEqual(site.legacyHosts, ['help.sessionboard.com', 'support.sessionboard.com']);
  const wrangler = read('wrangler.toml');
  assert.match(wrangler, /pattern = "help\.sessionboard\.com"\ncustom_domain = true/);
  assert.match(wrangler, /pattern = "support\.sessionboard\.com"\ncustom_domain = true/);
});

test('GA4 linker follows legacy hosts and keeps the single Help Center measurement id', () => {
  const domains = ga4LinkerDomains(site);
  assert.ok(domains.includes('support.sessionboard.com'));
  assert.ok(domains.includes('help.sessionboard.com'));
  assert.ok(domains.includes('learn.sessionboard.com'));
  assert.ok(domains.includes('www.sessionboard.com'));
  const head = read('src/components/Head.astro');
  assert.match(head, /G-Y3H82ZJMKG/);
  assert.doesNotMatch(head, /G-FMG151L6ME/);
  assert.match(head, /ga4LinkerDomains\(site\)/);
});

test('the release-notes email widget is not a second h1', () => {
  for (const rel of [
    'src/components/ReleaseNotesSubscribe.astro',
    'src/components/ReleaseNotesUpdatesDialog.astro',
    'src/components/Footer.astro',
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /<h1[\s>]/, rel);
    assert.doesNotMatch(src, /headingLevel="h1"/, rel);
    assert.doesNotMatch(src, /['"]h1['"]/, rel);
  }
  assert.match(read('src/components/ReleaseNotesUpdatesDialog.astro'), /headingLevel="h2"/);
  assert.match(read('src/components/PageTitle.astro'), /<h1 id="_top">/);
});

test('IndexNow is already wired: one public key file, submitted from Docs CI', () => {
  const keys = readdirSync(new URL('../public/', import.meta.url)).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
  assert.equal(keys.length, 1);
  const key = read(`public/${keys[0]}`).trim();
  assert.equal(`${key}.txt`, keys[0]);
  assert.match(read('.github/workflows/docs-ci.yml'), /node scripts\/indexnow-submit\.mjs/);
  assert.match(read('scripts/indexnow-submit.mjs'), /sitemap-index\.xml/);
});
