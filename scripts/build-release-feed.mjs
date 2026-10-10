#!/usr/bin/env node
/**
 * Emits dist/_internal/release-notes.json — the machine-readable release notes
 * that the TAM Hub (renewal "product evolution" timeline), the in-app Community
 * (What's New and the Roadmap's Shipped column — web-api syncs this file and
 * reads `ideas`, `live`, `live_at` and `url`) and Team Lead's "since you were
 * last here" read.
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

import { mediaForEntry } from '../src/lib/article-media.mjs';
import { enablementFacts } from '../src/lib/release-digest.mjs';
import {
  AVAILABILITY,
  ROOT,
  allEntries,
  articleTitle,
  enableHowLabel,
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

// Media items are site-relative in the source (`/images/kb/x.png`); the feed is
// read from other hosts (web-api → What's New, the hub), so make them absolute.
const absolute = (src) => (src && !/^https?:\/\//i.test(src) ? `${base}${src.startsWith('/') ? '' : '/'}${src}` : src || null);
const feedMedia = (raw) =>
  mediaForEntry(raw).map((m) =>
    m.type === 'video'
      ? { type: 'video', src: absolute(m.src), poster: absolute(m.poster), title: m.title || raw.title }
      : { type: 'image', src: absolute(m.src), alt: m.alt || raw.title },
  );

const entries = allEntries(releases).map((raw) => {
  const e = publicEntry(raw);
  return {
    ...e,
    // The same gallery the release-notes page shows for the entry: the listed
    // `media`, else the screenshots in the anchored article section.
    media: feedMedia(raw),
    summary_text: stripInline(e.summary),
    availability_label: AVAILABILITY[e.availability]?.label ?? null,
    enable_label: enableHowLabel(e.enable?.how, { staff: true }) ?? null,
    article_title: e.article ? articleTitle(e.article) : null,
    article_url: e.article ? `${base}${e.article}` : null,
    live: isLive(raw),
    live_at: isLive(raw) ? (raw.shipped?.docs_only ? raw.date : [raw.shipped.live.us, raw.shipped.live.eu].sort().at(-1)) : null,
    url: `${base}/help/release-notes#${raw.id}`,
    ideas: raw.ideas || [],
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
