#!/usr/bin/env node
/**
 * One-off: turn the prose bullets in help/release-notes.mdx into
 * src/data/release-notes/YYYY-MM-DD.json files.
 *
 * Each `- **Title** — summary … [Article](/path) · [Other](/path2)` bullet
 * becomes an entry with `title`, `summary` (the prose with its inline links
 * kept), `article` (the first trailing link) and `related` (the rest). Entries
 * are treated as live in both regions on their heading date — they were
 * documented when they shipped. Module is derived from the article folder;
 * kind is left unset for migrated entries so no badge claims more than we know.
 *
 * Idempotent: an existing file for a date is left alone unless --force.
 *
 *   node scripts/migrate-release-notes.mjs [--force] [--dry-run]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR, ROOT, moduleForPath } from '../src/lib/release-notes.mjs';

const SRC = join(ROOT, 'src', 'content', 'docs', 'help', 'release-notes.mdx');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isoDate(heading) {
  const m = /^(\w+) (\d{1,2}), (\d{4})$/.exec(heading.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/, '');

const TRAILING_LINK_RE = /\s*(?:·\s*)?\[([^\]]+)\]\((\/[^)\s]+)\)\s*$/;

function parseBullet(line) {
  const m = /^- \*\*(.+?)\*\* — (.*)$/.exec(line);
  if (!m) return null;
  const title = m[1];
  let rest = m[2].trim();
  const links = [];
  // Peel trailing "[Title](/path) · [Title](/path)" links off the end.
  for (;;) {
    const t = TRAILING_LINK_RE.exec(rest);
    if (!t) break;
    links.unshift({ title: t[1], path: t[2] });
    rest = rest.slice(0, t.index).trim();
  }
  return { title, summary: rest, article: links[0]?.path || null, related: links.slice(1).map((l) => l.path) };
}

const source = readFileSync(SRC, 'utf8');
const releases = new Map();
let current = null;
for (const line of source.split('\n')) {
  const h = /^## (.+)$/.exec(line);
  if (h) {
    current = isoDate(h[1]);
    if (current && !releases.has(current)) releases.set(current, []);
    continue;
  }
  if (!current || !line.startsWith('- ')) continue;
  const parsed = parseBullet(line);
  if (!parsed) {
    console.warn(`skip (not a release bullet) ${current}: ${line.slice(0, 80)}`);
    continue;
  }
  releases.get(current).push(parsed);
}

mkdirSync(DATA_DIR, { recursive: true });
let written = 0;
const usedIds = new Set();
for (const [date, bullets] of releases) {
  const out = join(DATA_DIR, `${date}.json`);
  if (existsSync(out) && !FORCE) continue;
  const entries = bullets.map((b) => {
    let id = slugify(b.title);
    let n = 2;
    while (usedIds.has(id)) id = `${slugify(b.title)}-${n++}`;
    usedIds.add(id);
    const entry = {
      id,
      title: b.title,
      summary: b.summary,
      article: b.article,
    };
    if (b.related.length) entry.related = b.related;
    const module = moduleForPath(b.article);
    if (module) entry.module = module;
    entry.shipped = { prs: [], docs_only: false, live: { us: date, eu: date, me: null }, announced_at: date };
    return entry;
  });
  const json = `${JSON.stringify({ date, entries }, null, 2)}\n`;
  if (DRY) console.log(`${out}: ${entries.length} entries`);
  else writeFileSync(out, json);
  written += 1;
}
console.log(`${DRY ? 'Would write' : 'Wrote'} ${written} release files to ${DATA_DIR}`);
