import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import site from '../site.json' with { type: 'json' };
import { isSignedInOnlyPath, isSignedInOnlySlug, isStaffOnlyHref, isStaffOnlyPath, isStaffOnlySlug, isStaffTierPath, staffOnlyGlobs } from '../src/lib/staff-only.mjs';
import { findProblems } from '../scripts/check-restricted-terms.mjs';

// The Help Center is public (2026-11-14) with two restricted tiers: staff (site.json staffOnly)
// and signed-in (site.json signedInOnly: registration, check-in, badges, lead scanning, Expo).

test('staff tier: registration, expo, onsite and attend are staff-only, not signed-in-only', () => {
  for (const p of ['/registration/overview', '/expo/floor-plan', '/onsite/web-desk', '/attend/leads', '/participants/attend-app']) {
    assert.equal(isStaffOnlyPath(p, site), true, p);
    assert.equal(isStaffTierPath(p, site), true, p);
    assert.equal(isSignedInOnlyPath(p, site), false, p);
  }
});

test('signed-in tier: registration API guide and reference, field events', () => {
  for (const p of ['/api/guides/registration-and-expo', '/api/reference/registration/list-ticket-types', '/api/reference/expo/list-booths', '/field-events/checkin', '/og/field-events--checkin.png']) {
    assert.equal(isStaffOnlyPath(p, site), true, p);
    assert.equal(isStaffTierPath(p, site), false, p);
    assert.equal(isSignedInOnlyPath(p, site), true, p);
  }
  assert.equal(isSignedInOnlySlug('field-events/registration-form', site), true);
});

test('ordinary pages and every product suite are public', () => {
  for (const p of ['/', '/sessions/accept-decline', '/api/insights/mcp-server', '/api/reference/overview', '/skills/build-the-agenda', '/sessionboard-marketing/get-started', '/sessionboard-crm/people', '/sessionboard-learning/get-started']) {
    assert.equal(isStaffOnlyPath(p, site), false, p);
  }
});

test('every build surface (sitemap, llms.txt, search, noindex) keeps out both tiers', () => {
  assert.equal(isStaffOnlySlug('api/guides/registration-and-expo', site), true);
  assert.equal(isStaffOnlySlug('registration/overview', site), true);
  const globs = staffOnlyGlobs(site);
  assert.ok(globs.includes('field-events/**'));
  assert.ok(globs.includes('registration/**'));
  assert.equal(isStaffOnlyHref('/field-events/checkin', site), true);
  assert.equal(isStaffOnlyHref('/field-events/checkin', site, 'staff'), false);
});

test('no public page mentions a restricted subject, and the public spec has no restricted operation', () => {
  assert.deepEqual(findProblems(), []);
  const spec = JSON.parse(readFileSync(new URL('../public/api/openapi.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(spec.paths).some((p) => /registration|ticket-types|check-ins|badge-print|booths/.test(p)), false);
});
