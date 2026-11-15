import { test } from 'node:test';
import assert from 'node:assert/strict';
import site from '../site.json' with { type: 'json' };
import { markRestrictedCards } from '../src/lib/restricted-cards.mjs';

test('a LinkCard to a signed-in-only page is marked; a public one is not', () => {
  const card = (href) => `<div class="sl-link-card astro-x"><span class="sl-flex stack astro-x"><a href="${href}" class="astro-x"><span class="title">T</span></a></span></div>`;
  assert.match(markRestrictedCards(card('/help/release-notes'), site), /<div class="sl-link-card astro-x" data-signed-in-only>/);
  assert.match(markRestrictedCards(card('/registration/forms'), site), /<div class="sl-link-card astro-x" data-staff-only>/);
  assert.equal(markRestrictedCards(card('/sessions/credit-claiming-setup'), site), card('/sessions/credit-claiming-setup'));
});

test('a StartTile or compat Card to a restricted page is marked on its <a>', () => {
  assert.equal(markRestrictedCards('<a class="sb-start-tile" href="/help/release-notes">', site), '<a class="sb-start-tile" data-signed-in-only href="/help/release-notes">');
  assert.equal(markRestrictedCards('<a class="sb-card" href="/expo/overview">', site), '<a class="sb-card" data-staff-only href="/expo/overview">');
  assert.equal(markRestrictedCards('<a class="sb-start-tile" href="/help/community">', site), '<a class="sb-start-tile" href="/help/community">');
});

test('marking twice changes nothing', () => {
  const once = markRestrictedCards('<a class="sb-start-tile" href="/help/release-notes">', site);
  assert.equal(markRestrictedCards(once, site), once);
});
