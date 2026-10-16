import test from 'node:test';
import assert from 'node:assert/strict';

import { GATED_AVAILABILITY, gateReason, isGated, isLive, isPublic, publicReleases, validateEntry } from '../src/lib/release-notes.mjs';

/**
 * Nothing gated behind Early Access reaches a public surface (Josh, 2026-10-15).
 * `isPublic` — not `isLive` — is the predicate for the Help Center release-notes
 * page, the feed's `live` flag (What's New, Roadmap Shipped, customer digest)
 * and Community drafts. These tests pin the derivation so a hand-written
 * `availability: "everyone"` cannot leak a beta feature.
 */

const contract = {
  features: ['sessions', 'pathways', 'marketing_clips', 'community', 'awards', 'sso', 'graduated'],
  featureNames: {},
  featureScopes: { sessions: ['event'], pathways: ['org'], marketing_clips: ['event'], community: ['org'], awards: ['org'], sso: ['org'], graduated: ['org'] },
  permissions: [],
  featureAvailability: {
    sessions: { scopes: { event: { adminCategory: 'products', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: null },
    pathways: { scopes: { org: { adminCategory: 'early_access', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: { stage: 'beta' } },
    marketing_clips: { scopes: { event: { adminCategory: 'early_access', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: { stage: 'preview' } },
    community: { scopes: { org: { adminCategory: 'early_access', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: null },
    awards: { scopes: { org: { adminCategory: 'products', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: null },
    sso: { scopes: { org: { adminCategory: 'features_enhancements', lifecycle: 'active' } }, lifecycle: 'active', earlyAccess: null },
    graduated: { scopes: { org: { adminCategory: 'early_access', lifecycle: 'ga' } }, lifecycle: 'ga', earlyAccess: { stage: 'beta' } },
  },
};

const LIVE = { us: '2026-10-10', eu: '2026-10-10', me: null };

const entry = (over) => ({
  id: 'an-entry',
  title: 'An entry',
  summary: 'Something shipped.',
  kind: 'improved',
  module: 'Program',
  shipped: { prs: ['lennd/sessionboard-web-api#1'], live: LIVE },
  ...over,
});

// Entries dated before CUTOVER so the strict field checks do not get in the way.
const resolve = (over) => {
  const e = entry(over);
  const problems = validateEntry(e, '2026-09-01', contract, { file: 'test' });
  assert.deepEqual(problems, []);
  return e;
};

test('the gated set is exactly the Early Access stages and limited releases', () => {
  assert.deepEqual([...GATED_AVAILABILITY].sort(), ['beta', 'limited_release', 'preview']);
});

test('a GA feature on for everyone is public once live', () => {
  const e = resolve({ features: ['sessions'] });
  assert.equal(e.availability, 'everyone');
  assert.equal(e.gated, null);
  assert.equal(isPublic(e), true);
});

test('beta, preview and limited-release features are live but never public', () => {
  for (const [feature, availability] of [
    ['pathways', 'beta'],
    ['marketing_clips', 'preview'],
    ['community', 'limited_release'],
  ]) {
    const e = resolve({ features: [feature] });
    assert.equal(e.availability, availability, feature);
    assert.equal(e.gated, `availability:${availability}`, feature);
    assert.equal(isLive(e), true, feature);
    assert.equal(isGated(e), true, feature);
    assert.equal(isPublic(e), false, feature);
  }
});

test('add-on, on-request and enterprise are GA behind a commercial toggle and stay public', () => {
  for (const availability of ['add_on', 'on_request', 'enterprise', 'everyone']) {
    const e = resolve({ availability });
    assert.equal(e.gated, null, availability);
    assert.equal(isPublic(e), true, availability);
  }
});

test('a hand-written availability cannot make a gated feature public', () => {
  const e = resolve({ availability: 'everyone', features: ['sessions', 'pathways'] });
  assert.equal(e.availability, 'everyone');
  assert.equal(e.gated, 'feature:pathways (beta)');
  assert.equal(isPublic(e), false);
});

test('a graduated feature is no longer gated', () => {
  const e = resolve({ features: ['graduated'] });
  assert.equal(e.availability, 'everyone');
  assert.equal(e.gated, null);
  assert.equal(isPublic(e), true);
});

test('staged entries are not public even when GA', () => {
  const e = resolve({ features: ['awards'], shipped: { prs: ['lennd/sessionboard-web-api#1'], live: { us: '2026-10-10', eu: null, me: null } } });
  assert.equal(e.gated, null);
  assert.equal(isLive(e), false);
  assert.equal(isPublic(e), false);
});

test('gateReason is null for an entry with no features and a public availability', () => {
  assert.equal(gateReason({ availability: 'everyone', features: [] }, contract), null);
  assert.equal(gateReason({ availability: 'beta', features: [] }, contract), 'availability:beta');
});

test('publicReleases drops gated entries and empties out dates that only had them', () => {
  const pub = resolve({ id: 'pub', features: ['awards'] });
  const gated = resolve({ id: 'gated', features: ['pathways'] });
  const releases = [
    { date: '2026-10-10', entries: [pub, gated] },
    { date: '2026-10-09', entries: [resolve({ id: 'only-gated', features: ['marketing_clips'] })] },
  ];
  const out = publicReleases(releases);
  assert.deepEqual(
    out.map((r) => [r.date, r.entries.map((e) => e.id)]),
    [['2026-10-10', ['pub']]],
  );
});
