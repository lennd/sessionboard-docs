#!/usr/bin/env node
/**
 * Seeds `features:` and `audience:` frontmatter across the corpus.
 *
 * Retrieval quality and the reader's "does this apply to me" banner both depend
 * on this taxonomy, and hand-tagging 227 articles would never finish. Folder
 * structure already encodes most of it, so this seeds what the folders make
 * obvious and leaves the rest for authors.
 *
 * Deliberately CONSERVATIVE. A wrong `features:` tag is worse than a missing
 * one: it collapses the applicability banner and drops the article from
 * retrieval for customers who do own the feature, so they are told the product
 * cannot do something it can. A missing tag just means the article shows to
 * everyone, which is where the corpus is today. So a folder is only mapped when
 * it corresponds 1:1 to a gated product area — `faq/`, `settings/`,
 * `integrations/` and friends stay untagged on purpose.
 *
 * Idempotent: an existing `features:` or `audience:` is never overwritten, so
 * an author's hand-tuned value survives every re-run.
 *
 * Usage:
 *   npm run taxonomy:tag
 *   npm run taxonomy:tag -- --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'src', 'content', 'docs');
const CONTRACT = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'product-contract.json'), 'utf8'),
);

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Folder → feature slugs. Only 1:1 mappings belong here.
 *
 * Notably absent, and why:
 *   faq/, videos/, get-started/, concepts/  — span every product area
 *   contacts/, communications/, settings/   — core surfaces, not gated
 *   integrations/, apps/                    — one feature per integration
 *   reporting/                              — mostly core; only the builder is gated
 *   site/, events/, event-team/, speakers/  — no single feature covers them
 *   portals/                                — portals are core. There is a
 *     `new_portals` feature, but it gates the redesigned portal experience, not
 *     the existence of portals, so tagging these with it would hide portal docs
 *     from everyone still on the current one.
 */
const FEATURES_BY_FOLDER = {
  'speaker-crm': ['crm'],
  marketing: ['marketing'],
  awards: ['awards'],
  applications: ['applications'],
  documents: ['documents'],
  studio: ['studio'],
  agents: ['coordinators'],
  sessions: ['sessions'],
  // Evaluation Plans are part of the Sessions module — an event without
  // Sessions has nothing to evaluate.
  evaluations: ['sessions'],
};

/**
 * Per-file overrides, for folders that mix two gated areas or hold one gated
 * article among core ones.
 */
const FEATURES_BY_FILE = {
  'sponsors-exhibitors/sponsors.mdx': ['sponsors'],
  'sponsors-exhibitors/sponsor-settings.mdx': ['sponsors'],
  'sponsors-exhibitors/sponsor-intake-form.mdx': ['sponsors'],
  'sponsors-exhibitors/exhibitor-intake-form.mdx': ['exhibitors'],
  'sponsors-exhibitors/adding-exhibitor-groups-contacts.mdx': ['exhibitors'],
  'reporting/insights-ai.mdx': ['ai_reports'],
};

/**
 * Folder → audience. Unlike features, audience never hides content — it only
 * steers retrieval, so an admin question stops returning speaker-portal steps.
 */
const AUDIENCE_BY_FOLDER = {
  participants: ['participant'],
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/** Split a file into [frontmatterLines, rest] without a YAML dependency. */
function splitFrontmatter(source) {
  const lines = source.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return { front: lines.slice(1, end), body: lines.slice(end + 1) };
}

const yamlList = (key, values) => `${key}: [${values.map((v) => `"${v}"`).join(', ')}]`;

const invalid = [];
for (const [source, features] of [
  ...Object.entries(FEATURES_BY_FOLDER),
  ...Object.entries(FEATURES_BY_FILE),
]) {
  for (const slug of features) {
    if (!CONTRACT.features.includes(slug)) invalid.push(`${source} → ${slug}`);
  }
}
if (invalid.length > 0) {
  console.error(
    '\n✖ This script maps folders to features that no longer exist:\n' +
      invalid.map((i) => `  - ${i}`).join('\n') +
      '\n\n  Run `npm run contract:pull`, then fix the maps in this file.\n',
  );
  process.exit(1);
}

let changed = 0;
let skipped = 0;

for (const file of walk(DOCS)) {
  const rel = relative(DOCS, file);
  const folder = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';

  const features = FEATURES_BY_FILE[rel] ?? FEATURES_BY_FOLDER[folder] ?? null;
  const audience = AUDIENCE_BY_FOLDER[folder] ?? null;
  if (!features && !audience) {
    skipped += 1;
    continue;
  }

  const source = readFileSync(file, 'utf8');
  const parts = splitFrontmatter(source);
  if (!parts) {
    console.warn(`  ! ${rel} has no frontmatter block — skipped`);
    skipped += 1;
    continue;
  }

  const additions = [];
  const hasKey = (key) => parts.front.some((line) => line.startsWith(`${key}:`));
  if (features && !hasKey('features')) additions.push(yamlList('features', features));
  if (audience && !hasKey('audience')) additions.push(yamlList('audience', audience));

  if (additions.length === 0) {
    skipped += 1;
    continue;
  }

  const next = ['---', ...parts.front, ...additions, '---', ...parts.body].join('\n');
  changed += 1;
  if (DRY_RUN) {
    console.log(`  would tag ${rel}: ${additions.join('  ')}`);
  } else {
    writeFileSync(file, next);
  }
}

console.log(
  `${DRY_RUN ? 'Would tag' : 'Tagged'} ${changed} article(s); ` +
    `${skipped} left for authors (no confident mapping, or already tagged).`,
);
