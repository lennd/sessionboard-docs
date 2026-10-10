#!/usr/bin/env node
/**
 * Which release entries have no thumbnail?
 *
 * A release card's gallery is whatever its guide shows (src/lib/article-media.mjs):
 * the chapters and screenshots in the section `article` points at, or the
 * `media` list when the author set one. An entry with neither renders as a
 * text-only card on /help/release-notes, in the Slack digest and on the
 * Enablement page. This lists those entries and says what would fix each:
 *
 *   add anchor  — the guide already has screenshots, the entry just links
 *                 the whole page; point `article` at the section (`#slug`)
 *                 or list the images in `media`
 *   screenshot  — the section (or the whole guide) has no image or chapter
 *                 at all; capture one per CLAUDE.md → Screenshots
 *   no article  — `article` does not resolve to a guide
 *
 *   node scripts/release-media.mjs                  # entries since the cutover
 *   node scripts/release-media.mjs --since 2026-10-01
 *   node scripts/release-media.mjs --all
 *   node scripts/release-media.mjs --json
 *   node scripts/release-media.mjs --summary FILE   # append a Markdown table
 *
 * Informational; exit 0. `--strict` exits 1 when anything is listed.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CUTOVER, DOCS_DIR, allEntries, loadReleaseNotes } from '../src/lib/release-notes.mjs';
import { mediaForArticle, mediaForEntry, slugify } from '../src/lib/article-media.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SINCE = flag('--all') ? '0000-00-00' : value('--since', CUTOVER);
const JSON_OUT = flag('--json');
const STRICT = flag('--strict');
const SUMMARY = value('--summary', null);

function headingsOf(file) {
  const src = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  return [...src.matchAll(/^(#{2,4})\s+(.+?)\s*#*\s*$/gm)].map((m) => ({ level: m[1].length, text: m[2], id: slugify(m[2]) }));
}

/** One finding per entry lacking media, or null. */
export function auditEntry(entry) {
  const media = mediaForEntry(entry);
  if (media.length) return null;

  const raw = String(entry.article || '');
  const anchor = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : '';
  const clean = raw.replace(/#.*$/, '').replace(/^\//, '');
  const file = join(DOCS_DIR, `${clean}.mdx`);
  const base = { id: entry.id, date: entry.date, title: entry.title, article: raw, kind: entry.kind };

  if (!clean || !existsSync(file)) return { ...base, fix: 'no article', detail: 'article path does not resolve to a guide' };

  const whole = mediaForArticle(`/${clean}`);
  const headings = headingsOf(file);
  if (!anchor) {
    if (whole.length) {
      return { ...base, fix: 'add anchor', detail: `guide has ${whole.length} media item(s); point article at a section: ${headings.slice(0, 6).map((h) => `#${h.id}`).join(' ')}` };
    }
    return { ...base, fix: 'screenshot', detail: 'guide has no screenshots or chapters anywhere' };
  }
  const known = headings.some((h) => h.id === anchor);
  if (!known) return { ...base, fix: 'add anchor', detail: `#${anchor} is not a heading in the guide (have: ${headings.slice(0, 6).map((h) => `#${h.id}`).join(' ')})` };
  return { ...base, fix: 'screenshot', detail: `section #${anchor} has no screenshot or chapter${whole.length ? ` (the guide has ${whole.length} elsewhere — list the right ones in media, or capture this control)` : ''}` };
}

export function audit({ since = SINCE, releases = loadReleaseNotes().releases } = {}) {
  return allEntries(releases)
    .filter((e) => e.date >= since)
    .map(auditEntry)
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function table(rows) {
  if (!rows.length) return '_Every entry in range has a thumbnail._\n';
  const lines = ['| Date | Entry | Fix | Detail |', '| --- | --- | --- | --- |'];
  for (const r of rows) lines.push(`| ${r.date} | \`${r.id}\` | ${r.fix} | ${r.detail.replace(/\|/g, '\\|')} |`);
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const rows = audit();
  if (JSON_OUT) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`\nRelease entries since ${SINCE} without a thumbnail: ${rows.length}\n`);
    for (const r of rows) console.log(`  ${r.date}  ${r.fix.padEnd(11)}  ${r.id}\n              ${r.article}\n              ${r.detail}`);
    if (rows.length) console.log('\n"add anchor" is a one-line edit to the entry; "screenshot" needs a capture per CLAUDE.md → Screenshots.');
    console.log('');
  }
  if (SUMMARY) appendFileSync(SUMMARY, `\n### Release entries without a thumbnail (since ${SINCE})\n\n${table(rows)}`);
  if (STRICT && rows.length) process.exit(1);
}
