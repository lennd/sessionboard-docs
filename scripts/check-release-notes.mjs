#!/usr/bin/env node
/**
 * Validate src/data/release-notes/*.json — the single source for what shipped.
 *
 * Fails the build when an entry names a module, feature, permission or article
 * that does not exist, or when an entry dated after the cutover is missing one
 * of the answers CS needs (module, availability, how to turn it on, where it
 * lives, why a customer wants it, what CS has to do, which PRs it shipped in).
 *
 *   node scripts/check-release-notes.mjs
 */

import { loadReleaseNotes, allEntries, isGated, isLive, isPublic } from '../src/lib/release-notes.mjs';

const { releases, problems } = loadReleaseNotes();

if (problems.length) {
  console.error(`\n✖ ${problems.length} release-notes problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Field reference: AGENTS.md → Release notes.\n');
  process.exit(1);
}

const entries = allEntries(releases);
const live = entries.filter(isLive).length;
const gated = entries.filter(isGated).length;
const pub = entries.filter(isPublic).length;
console.log(
  `✓ ${entries.length} release entries across ${releases.length} dates (${live} live, ${entries.length - live} staged; ${gated} gated behind Early Access → ${pub} public).`,
);
