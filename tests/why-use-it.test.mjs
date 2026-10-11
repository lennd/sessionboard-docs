import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WHY_USE_IT_KINDS, changelogPhrase } from '../src/lib/why-use-it.mjs';

test('flags release-note phrasing that goes stale once the change ships', () => {
  for (const text of [
    'Organizers who use HubSpot can now see how many contacts will be written.',
    'Organizers will no longer see a confusing status that never resolves.',
    'Organizers now get an immediate error message.',
    'The token is now labelled in the token list.',
  ]) {
    assert.ok(changelogPhrase(text), text);
  }
});

test('passes an evergreen description of the feature', () => {
  assert.equal(
    changelogPhrase(
      'Use a dry run to see how many contacts a HubSpot sync will write and how well they match before you sync for real.',
    ),
    null,
  );
  assert.equal(changelogPhrase('Know your audience before you publish.'), null);
});

test('only new and improved entries ask the article for a "Why use it"', () => {
  assert.ok(WHY_USE_IT_KINDS.has('new'));
  assert.ok(WHY_USE_IT_KINDS.has('improved'));
  assert.ok(!WHY_USE_IT_KINDS.has('fixed'));
});
