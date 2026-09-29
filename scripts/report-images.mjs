#!/usr/bin/env node
/**
 * Drift detector: which screenshots are regenerable, which are legacy, which are orphans.
 *
 *   node scripts/report-images.mjs           # human report
 *   node scripts/report-images.mjs --json    # for the content-refresh queue
 *
 * Every image under public/images is one of:
 *   generated  — listed in src/data/stills.json, i.e. produced by a `shot:` in an action plan
 *                (sessionboard-tam/training-videos, `capture.mjs --stills --docs`). Re-running
 *                the plan refreshes it; the plan is what goes stale, not the PNG.
 *   legacy     — a HubSpot export or hand-taken capture (hex-dated name, "Screen-Shot-…",
 *                "image-png-…"). No plan can refresh it; it is re-shot or retired.
 *   orphan     — referenced by no article. Safe to delete.
 *
 * Per article the report counts each class so the queue can rank "all legacy" pages first.
 * Nothing here judges whether a legacy image is *wrong*; the 2026-09-28 screenshot audit
 * found ≈45% of sampled chrome-bearing legacy images show a retired sidebar, so "legacy"
 * is the signal, and the shot list per article is the work.
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(here, '..');
const DOCS = path.join(ROOT, 'src', 'content', 'docs');
const IMAGES = path.join(ROOT, 'public', 'images');
const json = process.argv.includes('--json');

const stillsFile = path.join(ROOT, 'src', 'data', 'stills.json');
const stills = fs.existsSync(stillsFile) ? JSON.parse(fs.readFileSync(stillsFile, 'utf8')) : {};
const LEGACY = /(^|\/)([0-9a-f]{8}-|Screen-?Shot|image-png|image-\d|Screenshot[ _-]|Screen[ _-]Recording|Pasted|unnamed|CleanShot)/i;

const files = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(n)) files.push(path.relative(IMAGES, p));
  }
})(IMAGES);
const classify = (rel) => (stills[rel] ? 'generated' : LEGACY.test(rel) ? 'legacy' : 'other');

const referenced = new Map(); // image rel -> [slugs]
const perArticle = [];
(function read(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) read(p);
    else if (/\.mdx?$/.test(n)) {
      const slug = path.relative(DOCS, p).replace(/\.mdx?$/, '');
      const src = fs.readFileSync(p, 'utf8');
      const refs = [...src.matchAll(/\/images\/([^\s"')>]+?\.(?:png|jpe?g|gif|webp|svg))/gi)].map((m) => decodeURIComponent(m[1]));
      const uniq = [...new Set(refs)];
      const counts = { generated: 0, legacy: 0, other: 0, missing: 0 };
      const images = uniq.map((rel) => {
        const exists = fs.existsSync(path.join(IMAGES, rel));
        const cls = exists ? classify(rel) : 'missing';
        counts[cls]++;
        if (!referenced.has(rel)) referenced.set(rel, []);
        referenced.get(rel).push(slug);
        return { file: rel, class: cls, ...(stills[rel] ? { plan: stills[rel].plan, step: stills[rel].step } : {}) };
      });
      if (uniq.length) perArticle.push({ article: slug, counts, images });
    }
  }
})(DOCS);

const orphans = files.filter((f) => !referenced.has(f) && !/^kb\/og|^og\//.test(f));
const totals = { files: files.length, referenced: referenced.size, generated: 0, legacy: 0, other: 0, orphans: orphans.length };
for (const f of files) if (referenced.has(f)) totals[classify(f)]++;

perArticle.sort((a, b) => b.counts.legacy - a.counts.legacy || a.article.localeCompare(b.article));
if (json) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), totals, articles: perArticle, orphans }, null, 2));
} else {
  for (const a of perArticle.slice(0, 40)) console.log(`${String(a.counts.legacy).padStart(3)} legacy ${String(a.counts.generated).padStart(3)} generated  ${a.article}`);
  if (perArticle.length > 40) console.log(`  … ${perArticle.length - 40} more articles`);
  console.log(`\n${totals.files} image files; ${totals.referenced} referenced (${totals.generated} generated, ${totals.legacy} legacy, ${totals.other} other); ${totals.orphans} orphans.`);
}
