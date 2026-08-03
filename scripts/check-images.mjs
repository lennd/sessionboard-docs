#!/usr/bin/env node
/**
 * CI gate: fail if any docs page references an externally hosted image.
 * All screenshots must live in public/images/ (see STYLE.md).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = new URL('../src/content/docs', import.meta.url).pathname;
const IMG = /https?:\/\/[^\s"')]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s"')]*)?/gi;

const failures = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.mdx') || name.endsWith('.md')) {
      const matches = readFileSync(p, 'utf8').match(IMG) ?? [];
      for (const url of matches) failures.push(`${p.replace(DOCS + '/', '')}: ${url}`);
    }
  }
}
walk(DOCS);

if (failures.length) {
  console.error(`Found ${failures.length} external image reference(s) — re-host with scripts/rehost-images.py:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('No external image references.');
