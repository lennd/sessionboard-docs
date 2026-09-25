#!/usr/bin/env node
/**
 * Fails when the sidebar article stops describing the shipped sidebar.
 *
 * `src/content/docs/get-started/sidebar.mdx` is a map of the product's
 * navigation, and navigation changes often — a module gets renamed, a link moves
 * between modules, a new one appears. Nobody editing `org-layout.js` in
 * sessionboard-web-api has a reason to remember this repo exists, so without a
 * gate the article rots into a map of a building that has been remodelled, which
 * is worse for a reader than no map at all.
 *
 * The gate is coverage, not equality: every module name and every link name in
 * `src/data/nav-manifest.json` has to appear somewhere in the article. That
 * deliberately allows the article to group, explain and re-order things however
 * reads best, while making it impossible to ship a sidebar item the article has
 * never heard of.
 *
 * Refresh the manifest with `npm run nav:pull` (needs sessionboard-web-api
 * checked out beside this repo). The manifest excludes super-user-only links, so
 * this never asks you to document internal surfaces.
 *
 * Feature-gated items (a `feature_id` in the manifest) are OPTIONAL coverage:
 * they belong to Early Access betas/previews most readers do not have, and the
 * article deliberately describes only the released sidebar (GA scrub,
 * 2026-09-26). They are skipped, not banned — an EA feature's own article may
 * still describe its nav. When a feature graduates to GA, its gate comes off in
 * `{org,event}-layout.js`, the `feature_id` disappears from the manifest on the
 * next `nav:pull`, and this check starts requiring the item — so graduation
 * cannot silently leave the article stale.
 *
 * Usage:
 *   npm run nav:check
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE = join(ROOT, 'src', 'content', 'docs', 'get-started', 'sidebar.mdx');
const MANIFEST = join(ROOT, 'src', 'data', 'nav-manifest.json');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const article = readFileSync(ARTICLE, 'utf8');

/**
 * Names are compared with punctuation and case flattened, so "Tickets & Pricing"
 * in the layout still matches "Tickets and pricing" in a sentence. The check is
 * about whether the reader is told the thing exists, not about copying labels
 * verbatim into prose.
 */
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const haystack = normalize(article);
const mentions = (name) => haystack.includes(normalize(name));

const missing = [];

// Early Access / beta items carry a feature_id; the released sidebar does not.
const gated = (entry) => Boolean(entry.feature_id);

for (const scope of ['org', 'event']) {
  const scopeLabel = scope === 'org' ? 'Organization' : 'Event';
  for (const mod of manifest[scope].modules) {
    if (gated(mod)) continue;
    if (!mentions(mod.name)) {
      missing.push(`${scopeLabel} module "${mod.name}"`);
    }
    for (const section of mod.sections) {
      for (const item of section.items) {
        if (gated(item)) continue;
        if (!mentions(item.name)) {
          missing.push(`${scopeLabel} → ${mod.name} → "${item.name}"`);
        }
      }
    }
  }
  for (const zone of ['top', 'flat', 'footer']) {
    for (const item of manifest[scope][zone]) {
      if (gated(item)) continue;
      if (!mentions(item.name)) {
        missing.push(`${scopeLabel} ${zone} → "${item.name}"`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error(
    `\n✖ The sidebar changed and get-started/sidebar.mdx does not mention ${missing.length} item(s):\n`,
  );
  for (const line of [...new Set(missing)]) console.error(`  ${line}`);
  console.error(
    '\nAdd them to the article, then re-run `npm run nav:check`.\n' +
      'If an item was renamed or removed in sessionboard-web-api, run `npm run nav:pull`\n' +
      'first so the manifest matches what actually ships.\n',
  );
  process.exit(1);
}

console.log(
  'get-started/sidebar.mdx covers every module and link in src/data/nav-manifest.json.',
);
