#!/usr/bin/env node
/**
 * Guard: no restricted page (site.json `staffOnly` or `signedInOnly`, plus unreleased suites;
 * src/lib/staff-only.mjs) may appear in a public text export in dist/: llms.txt, llms-full.txt,
 * llms-small.txt, any api/llms.txt, or any other .txt/.md the build emits. For every restricted
 * content page it fails on the page's route path, or its `# Title` heading line (unless a public
 * page shares that title). Run after `npm run build`:
 *
 *   node scripts/check-public-exports.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStaffOnlySlug } from '../src/lib/staff-only.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'src/content/docs');
const DIST = join(ROOT, 'dist');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

function walk(dir, test, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '_astro' || name === 'pagefind') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, test, out);
    else if (test(name)) out.push(p);
  }
  return out;
}

const titleOf = (src) => {
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  const m = fm && fm[1].match(/^title:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/m);
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null;
};

if (!existsSync(DIST)) {
  console.error('check-public-exports: dist/ missing. Run `npm run build` first.');
  process.exit(1);
}

const restricted = [];
const publicTitles = new Set();
for (const file of walk(DOCS, (n) => /\.mdx?$/.test(n))) {
  const slug = relative(DOCS, file).replace(/\.mdx?$/, '').replace(/\/index$/, '');
  const title = titleOf(readFileSync(file, 'utf8'));
  if (isStaffOnlySlug(slug, site)) restricted.push({ slug, title });
  else if (title) publicTitles.add(title);
}

const exportsToCheck = walk(DIST, (n) => /\.(txt|md)$/.test(n)).filter((f) => !/^[0-9a-f]{32}\.txt$/.test(f.split('/').pop()));
const failures = [];
for (const file of exportsToCheck) {
  const text = readFileSync(file, 'utf8');
  const lines = new Set(text.split('\n'));
  for (const { slug, title } of restricted) {
    // A markdown link target `](/slug)` from a public page is not the page itself (public pages
    // may link to signed-in pages); any other occurrence of the route is.
    const pathRe = new RegExp(`(?<!\\]\\()/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    const pathHit = pathRe.test(text);
    const titleHit = title && !publicTitles.has(title) && lines.has(`# ${title}`);
    if (pathHit || titleHit) {
      failures.push(`${relative(ROOT, file)}: ${slug}${titleHit ? ` (title "${title}")` : ''}${pathHit ? ' (path)' : ''}`);
    }
  }
}

console.log(`check-public-exports: ${restricted.length} restricted pages, ${exportsToCheck.length} public text exports`);
if (failures.length) {
  console.error('::error::Restricted pages in public text exports:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('check-public-exports: ok');
