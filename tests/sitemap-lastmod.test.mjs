import test from 'node:test';
import assert from 'node:assert/strict';

import { createLastmodLookup, normalizeSitemapPath, parseGitNameLog } from '../src/lib/sitemap-lastmod.mjs';

test('git name log keeps the newest commit for each file', () => {
  const dates = parseGitNameLog(`2026-11-05T17:07:02-06:00

src/content/docs/faq/is-sessionboard-down.mdx

2026-10-01T20:47:05-05:00

src/content/docs/faq/is-sessionboard-down.mdx
src/content/docs/index.mdx
`);
  assert.equal(dates.get('src/content/docs/faq/is-sessionboard-down.mdx'), '2026-11-05T17:07:02-06:00');
  assert.equal(dates.get('src/content/docs/index.mdx'), '2026-10-01T20:47:05-05:00');
});

test('sitemap paths drop a trailing slash and .html, and keep the home page', () => {
  assert.equal(normalizeSitemapPath('https://learn.sessionboard.com/'), '/');
  assert.equal(normalizeSitemapPath('https://learn.sessionboard.com/faq/overview'), '/faq/overview');
  assert.equal(normalizeSitemapPath('https://learn.sessionboard.com/faq/overview/'), '/faq/overview');
  assert.equal(normalizeSitemapPath('https://learn.sessionboard.com/faq/overview.html'), '/faq/overview');
});

test('a published FAQ page gets a real lastmod, not the build clock', () => {
  const lookup = createLastmodLookup();
  const date = lookup('https://learn.sessionboard.com/faq/is-sessionboard-down');
  assert.ok(date instanceof Date);
  assert.ok(date >= new Date('2026-10-01T00:00:00Z'));
  assert.ok(date < new Date('2027-01-01T00:00:00Z'));
  const home = lookup('https://learn.sessionboard.com/');
  assert.ok(home instanceof Date);
});
