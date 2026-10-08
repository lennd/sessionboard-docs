#!/usr/bin/env node
/**
 * Emits dist/_internal/release-notes.json — the machine-readable release notes
 * that the TAM Hub (renewal "product evolution" timeline), the Community
 * What's New drafts and Team Lead's "since you were last here" read.
 *
 * Served behind the same bearer token as help-index.json (worker.js
 * INTERNAL_PREFIX). Raw `internal.*` is stripped; what the hub shows per item
 * is the `enablement` block — the same seven line items as the entry's
 * /enablement/releases/<id> page (why, when, who, CS action, turn on, where,
 * show the customer), which is itself unlisted but public. Entries therefore
 * never hold anything sensitive; that goes in Jira or Slack.
 *
 *   npm run build && node scripts/build-release-feed.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { enablementFacts } from '../src/lib/release-digest.mjs';
import {
  AVAILABILITY,
  ENABLE_HOW,
  ROOT,
  allEntries,
  articleTitle,
  isLive,
  loadReleaseNotes,
  publicEntry,
  readSite,
  stripInline,
} from '../src/lib/release-notes.mjs';

const DIST = join(ROOT, 'dist');
const OUT = join(DIST, '_internal', 'release-notes.json');
const FEED_VERSION = 2;

if (!existsSync(DIST)) {
  console.error('\n✖ No dist/ — run `npm run build` first.\n');
  process.exit(1);
}

const { releases, problems } = loadReleaseNotes();
if (problems.length) {
  console.error(`\n✖ release notes invalid:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const site = readSite();
const base = `https://${site.canonicalHost}`;

const entries = allEntries(releases).map((raw) => {
  const e = publicEntry(raw);
  return {
    ...e,
    summary_text: stripInline(e.summary),
    availability_label: AVAILABILITY[e.availability]?.label ?? null,
    enable_label: ENABLE_HOW[e.enable?.how] ?? null,
    article_title: e.article ? articleTitle(e.article) : null,
    article_url: e.article ? `${base}${e.article}` : null,
    live: isLive(raw),
    enablement: enablementFacts(raw, { base, site }),
  };
});

const feed = {
  feedVersion: FEED_VERSION,
  canonicalHost: site.canonicalHost,
  builtAt: new Date().toISOString(),
  entryCount: entries.length,
  liveCount: entries.filter((e) => e.live).length,
  entries,
};

mkdirSync(join(DIST, '_internal'), { recursive: true });
writeFileSync(OUT, JSON.stringify(feed));
console.log(`Wrote ${relative(ROOT, OUT)}\n  ${feed.entryCount} entries (${feed.liveCount} live)`);
