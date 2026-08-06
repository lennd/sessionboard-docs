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

const map = {};
let skipped = 0;
for (const line of lines.slice(1)) {
  const cols = splitCsvLine(line);
  const oldUrl = cols[oldUrlIdx];
  const newPath = cols[newPathIdx];
  // Rows whose target page isn't in the build are drafts/archived articles that
  // were never publicly live — the worker's fallback covers their slugs.
  if (!oldUrl || !newPath || !newPath.startsWith('/') || !pageExists(newPath)) {
    skipped++;
    continue;
  }
  // Some HubSpot slugs contain a slash (e.g. `video-accept/decline-sessions`),
  // so keep everything after /knowledge-base/ rather than the last segment.
  const slug = new URL(oldUrl).pathname
    .replace(/\/$/, '')
    .replace(/^\/(?:en\/)?knowledge-base\//, '');
  map[slug] = newPath;
}

writeFileSync(new URL('../redirects-map.json', import.meta.url), JSON.stringify(map, null, 1) + '\n');
console.log(`Wrote redirects-map.json: ${Object.keys(map).length} live slugs (${skipped} rows skipped: draft/archived/no target)`);
