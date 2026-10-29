import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/lib/article-media.mjs';

// The heading ids Starlight renders come from github-slugger, which turns every
// space into a hyphen. Release links and media discovery must use the same ids,
// or a link stops landing on its section (2026-10-21 / 2026-10-22 entries).
test('slugify matches the rendered heading id for headings with punctuation', () => {
  assert.equal(slugify('Site URL & branding'), 'site-url--branding');
  assert.equal(slugify('Program statuses & lifecycle'), 'program-statuses--lifecycle');
  assert.equal(slugify('Review and approve'), 'review-and-approve');
  assert.equal(slugify('**Why** use it'), 'why-use-it');
});
