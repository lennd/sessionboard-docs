#!/usr/bin/env node
/**
 * Generate redirects-map.json (HubSpot KB slug → new docs path) from
 * redirects-301.csv, consumed by worker.js at the edge.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const csv = readFileSync(new URL('../redirects-301.csv', import.meta.url), 'utf8');
const lines = csv.split('\n').filter(Boolean);
const header = splitCsvLine(lines[0]);
const oldUrlIdx = header.indexOf('old_url');
const newPathIdx = header.indexOf('new_path');

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

import { existsSync } from 'node:fs';

const distDir = new URL('../dist/', import.meta.url);
const pageExists = (path) => {
  const p = path.replace(/^\//, '');
  return p === '' || existsSync(new URL(`${p}.html`, distDir)) || existsSync(new URL(`${p}/index.html`, distDir));
};

if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first so targets can be validated.');
  process.exit(1);
}

// The release notes were retired in favour of the Canny changelog, so no page
// is built for them — but the worker still needs these slugs in the map to
// recognise them and send them onward, or they would fall back to the FAQ hub.
const routedOffSite = (path) => path.startsWith('/release-notes');

// A target that was itself retired after launch is still a live mapping: the
// worker resolves `movedTo(mapped)` and sends the legacy slug to the
// replacement in one hop. Dropping such rows here would send those slugs to
// the FAQ hub instead. worker.js cannot be imported from Node (its JSON
// imports have no attributes), so read its INTERNAL_REDIRECTS block as text.
const workerSrc = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const internalBlock = workerSrc.match(/const INTERNAL_REDIRECTS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const movedTo = Object.fromEntries(
  [...internalBlock.matchAll(/^\s*'(\/[^']+)':\s*'(\/[^']+)',?\s*$/gm)].map((m) => [m[1], m[2]]),
);
Object.assign(movedTo, JSON.parse(readFileSync(new URL('../training-redirects.json', import.meta.url), 'utf8')));
const retiredButRedirected = (path) => {
  const next = movedTo[path.replace(/\/$/, '')];
  return Boolean(next) && pageExists(next.replace(/#.*$/, ''));
};

const map = {};
let skipped = 0;
for (const line of lines.slice(1)) {
  const cols = splitCsvLine(line);
  const oldUrl = cols[oldUrlIdx];
  const newPath = cols[newPathIdx];
  // Rows whose target page isn't in the build are drafts/archived articles that
  // were never publicly live — the worker's fallback covers their slugs.
  if (!oldUrl || !newPath || !newPath.startsWith('/')) {
    skipped++;
    continue;
  }
  if (!pageExists(newPath) && !routedOffSite(newPath) && !retiredButRedirected(newPath)) {
    skipped++;
    continue;
  }
  // Some HubSpot slugs contain a slash (e.g. `video-accept/decline-sessions`),
  // so keep everything after /knowledge-base/ rather than the last segment.
  // `/en/migrated/knowledge-base/` is an older HubSpot path prefix that Google
  // still has indexed; it resolves to the same slug namespace.
  const slug = new URL(oldUrl).pathname
    .replace(/\/$/, '')
    .replace(/^\/(?:en\/)?(?:migrated\/)?knowledge-base\//, '');
  map[slug] = newPath;
}

writeFileSync(new URL('../redirects-map.json', import.meta.url), JSON.stringify(map, null, 1) + '\n');
console.log(`Wrote redirects-map.json: ${Object.keys(map).length} live slugs (${skipped} rows skipped: draft/archived/no target)`);
