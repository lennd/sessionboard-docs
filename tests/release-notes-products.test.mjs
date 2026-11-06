import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { forProduct, onPlatform, validateEntry } from '../src/lib/release-notes.mjs';
import { pendingFor } from '../src/lib/release-digest.mjs';

/**
 * Self-serve release notes stay inside their own suite
 * (.cursor/rules/product-docs-suites.mdc rule 4): no Slack post, no email, no
 * public page or feed, no Enablement — unless the change is also on Platform.
 */

const ROOT = new URL('..', import.meta.url).pathname;
const contract = { features: [], featureNames: {}, featureScopes: {}, permissions: [], featureAvailability: {} };
const LIVE = { us: '2026-11-01', eu: '2026-11-01', me: null };

const base = (over) => ({
  title: 'An entry',
  summary: 'Something shipped.',
  kind: 'new',
  use_case: 'Because customers asked.',
  shipped: { prs: ['lennd/sessionboard-web-api#1'], live: LIVE },
  ...over,
});
const platformEntry = base({
  id: 'platform-thing',
  title: 'A Platform change',
  article: '/awards/getting-started',
  module: 'Awards',
  where: { scope: 'org', path: 'Awards' },
  internal: { when_to_bring_up: 'Always.' },
});
const awardsOnly = base({ id: 'awards-only-thing', title: 'An Awards self-serve change', product: 'awards', article: '/sessionboard-awards/get-started' });
const awardsAndPlatform = base({
  id: 'awards-and-platform-thing',
  title: 'A change on both sides',
  product: 'awards',
  platform: true,
  article: '/sessionboard-awards/get-started',
  module: 'Awards',
  where: { scope: 'org', path: 'Awards' },
  internal: { when_to_bring_up: 'Always.' },
});

test('product defaults to platform; self-serve entries are Platform-visible only with platform: true', () => {
  assert.equal(onPlatform({}), true);
  assert.equal(onPlatform({ product: 'marketing' }), false);
  assert.equal(onPlatform({ product: 'marketing', platform: true }), true);
  assert.equal(forProduct({ product: 'learning' }, 'learning'), true);
  assert.equal(forProduct({ product: 'learning' }, 'marketing'), false);
  assert.equal(forProduct({}, 'learning'), false);
  assert.equal(forProduct({ product: 'awards' }, 'all'), true);
});

test('validation: product must be known and the article must be in its own suite', () => {
  const ok = structuredClone(awardsOnly);
  assert.deepEqual(validateEntry(ok, '2026-11-06', contract), []);
  assert.equal(ok.product, 'awards');
  assert.equal(ok.platform, false);

  const wrongSuite = validateEntry(base({ id: 'x', product: 'awards', article: '/awards/getting-started' }), '2026-11-06', contract);
  assert.ok(wrongSuite.some((p) => /not in the awards suite/.test(p)), wrongSuite.join('\n'));

  const platformIntoSuite = validateEntry(structuredClone({ ...platformEntry, id: 'y', article: '/sessionboard-awards/get-started' }), '2026-11-06', contract);
  assert.ok(platformIntoSuite.some((p) => /self-serve suite/.test(p)), platformIntoSuite.join('\n'));

  assert.ok(validateEntry(base({ id: 'z', product: 'nope', article: '/awards/getting-started' }), '2026-11-06', contract).some((p) => /product "nope"/.test(p)));
});

test('a self-serve-only entry asks for none of the CS fields', () => {
  const problems = validateEntry(structuredClone(awardsOnly), '2026-11-06', contract);
  assert.deepEqual(problems, []);
});

test('pendingFor never sees what the Platform view dropped', () => {
  const releases = [{ date: '2026-11-06', entries: [platformEntry, awardsAndPlatform].map((e) => ({ ...structuredClone(e), date: '2026-11-06', shipped: { ...e.shipped, announced_at: null, emailed_at: null } })) }];
  assert.deepEqual(pendingFor(releases, 'slack').map((e) => e.id), ['platform-thing', 'awards-and-platform-thing']);
});

// ── The real scripts, against a fixture release file ─────────────────────

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sb-release-products-'));
  copyFileSync(join(ROOT, 'src/data/release-notes/_config.json'), join(dir, '_config.json'));
  writeFileSync(join(dir, '2026-11-06.json'), JSON.stringify({ date: '2026-11-06', entries: [platformEntry, awardsOnly, awardsAndPlatform] }, null, 2));
  return dir;
}

const run = (script, args, dir) =>
  execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // Never a real webhook or mail key: these are dry runs.
    env: { PATH: process.env.PATH, SB_RELEASE_NOTES_DIR: dir },
  });

test('release-slack.mjs skips self-serve-only entries', () => {
  const out = run('release-slack.mjs', ['--since', '2026-11-01'], fixtureDir());
  assert.match(out, /A Platform change/);
  assert.match(out, /A change on both sides/);
  assert.doesNotMatch(out, /An Awards self-serve change/);
  assert.match(out, /2 entries; nothing posted/);
});

test('release-email.mjs skips self-serve-only entries', () => {
  const out = run('release-email.mjs', ['--dry-run', '--since', '2026-11-01'], fixtureDir());
  assert.doesNotMatch(out, /An Awards self-serve change/);
});

test('check-release-notes.mjs validates every product', () => {
  const out = run('check-release-notes.mjs', [], fixtureDir());
  assert.match(out, /3|✓/);
});
