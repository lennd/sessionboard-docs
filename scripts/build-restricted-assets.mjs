#!/usr/bin/env node
/**
 * Screenshots and media of restricted pages (site.json staffOnly / signedInOnly,
 * src/lib/staff-only.mjs) inherit their page's tier, so a signed-out request for
 * `/images/kb/registration-form-editor-tickets.png` gets the same answer as the page.
 *
 * Writes src/data/restricted-assets.json: { "/images/kb/x.png": "staff" | "signedIn" }.
 *   - An asset referenced by any public page stays public.
 *   - An asset referenced only by restricted pages takes the least restrictive of their
 *     tiers (signed-in beats staff).
 *   - An asset no page references, whose file name starts with a restricted section
 *     (registration-, expo-, onsite-, attend-, field-events-), takes that section's tier.
 *
 *   node scripts/build-restricted-assets.mjs           # write
 *   node scripts/build-restricted-assets.mjs --check   # fail when stale (Docs CI)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSignedInOnlySlug, isStaffOnlySlug, staffOnlyRule } from '../src/lib/staff-only.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/data/restricted-assets.json');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const ASSET_DIRS = ['images/kb', 'media'];
const REF = /\/(?:images|media)\/[A-Za-z0-9._\/-]+\.[A-Za-z0-9]{2,5}/g;

function walk(dir, test) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, test) : test(name) ? [full] : [];
  });
}

const tierOfSlug = (slug) => (!isStaffOnlySlug(slug, site) ? 'public' : isSignedInOnlySlug(slug, site) ? 'signedIn' : 'staff');
const RANK = { public: 0, signedIn: 1, staff: 2 };

export function buildMap() {
  /** asset path → least restrictive tier among the pages that reference it */
  const seen = new Map();
  const note = (asset, tier) => {
    const was = seen.get(asset);
    if (!was || RANK[tier] < RANK[was]) seen.set(asset, tier);
  };
  const docs = join(ROOT, 'src/content/docs');
  for (const file of walk(docs, (n) => /\.mdx?$/.test(n))) {
    const slug = relative(docs, file).replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
    const tier = tierOfSlug(slug);
    for (const m of readFileSync(file, 'utf8').matchAll(REF)) note(m[0], tier);
  }
  // Release-note entries: a product suite's entries show on its public What's new page; Platform
  // entries only on /help/release-notes (signed-in). An entry's own article can restrict it further.
  const notesDir = join(ROOT, 'src/data/release-notes');
  for (const file of walk(notesDir, (n) => n.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const entry of Array.isArray(data) ? data : (data.entries ?? [])) {
      const article = String(entry.article ?? '').replace(/^\/+|[#?].*$/g, '');
      const own = article ? tierOfSlug(article) : 'public';
      const page = entry.product && entry.product !== 'platform' ? 'public' : tierOfSlug('help/release-notes');
      const tier = RANK[own] > RANK[page] ? own : page;
      for (const m of JSON.stringify(entry).matchAll(REF)) note(m[0], tier);
    }
  }
  // Everything else that ships HTML (components, pages, product API guides, other data) is public.
  for (const dir of ['src/components', 'src/pages', 'src/api-docs', 'src/data', 'src/layouts']) {
    for (const file of walk(join(ROOT, dir), (n) => /\.(astro|mdx?|tsx?|mjs|js|json)$/.test(n) && n !== 'restricted-assets.json')) {
      if (file.startsWith(notesDir)) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(REF)) note(m[0], 'public');
    }
  }
  // Unreferenced files named for a restricted section.
  const { prefixes } = staffOnlyRule(site);
  const sections = prefixes.filter((p) => !p.includes('/'));
  for (const sub of ASSET_DIRS) {
    for (const file of walk(join(ROOT, 'public', sub), () => true)) {
      const asset = `/${relative(join(ROOT, 'public'), file)}`;
      if (seen.has(asset)) continue;
      const base = asset.split('/').pop();
      const section = sections.find((p) => base.startsWith(`${p}-`) || base.startsWith(`${p}_`));
      if (section) note(asset, tierOfSlug(section));
    }
  }
  const out = {};
  for (const [asset, tier] of [...seen].sort(([a], [b]) => a.localeCompare(b))) if (tier !== 'public') out[asset] = tier;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = JSON.stringify(buildMap(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== json) {
      console.error('src/data/restricted-assets.json is stale — run `npm run assets:restricted` and commit the result.');
      process.exit(1);
    }
    console.log(`Restricted assets are in sync (${Object.keys(JSON.parse(json)).length}).`);
  } else {
    writeFileSync(OUT, json);
    console.log(`Wrote ${relative(ROOT, OUT)} (${Object.keys(JSON.parse(json)).length} restricted assets).`);
  }
}
