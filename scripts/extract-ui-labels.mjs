#!/usr/bin/env node
/**
 * Refresh src/data/ui-labels.json from sessionboard-web-ui-v2.
 *
 *   node scripts/extract-ui-labels.mjs --ui ../sessionboard-web-ui-v2 [--portal ../sessionboard-web-org-portal]
 *
 * The Help Center writes UI labels in bold ("click **Create Form**"). When the product
 * renames a button, the article keeps the old name and nobody notices until a customer
 * cannot find it. This corpus is every string the admin app can put on screen:
 *
 *   - public/locales/en/*.json         the i18n bundles (≈12k strings)
 *   - `defaultValue: '…'` in t() calls  strings not yet in a bundle
 *   - short JSX text nodes              `<Button>Save changes</Button>` and the like
 *   - src/data/nav-manifest.json        module and link names from the API
 *
 * `npm run labels:check` (scripts/check-labels.mjs) compares bold spans against it. Like
 * nav-manifest.json and product-contract.json, the file is committed so the check runs
 * without a web-ui-v2 checkout; refresh it whenever the app ships label changes (the
 * content-refresh workflow does this on its schedule).
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from './lib/labels.mjs';

const args = process.argv.slice(2);
const ui = path.resolve(args.includes('--ui') ? args[args.indexOf('--ui') + 1] : process.env.SB_WEB_UI_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'sessionboard-web-ui-v2'));
if (!ui || !fs.existsSync(path.join(ui, 'src'))) {
  console.error('usage: node scripts/extract-ui-labels.mjs --ui <path-to-sessionboard-web-ui-v2>');
  process.exit(2);
}
// Optional: the speaker/evaluator portal (sessionboard-web-org-portal). Articles under
// evaluations/ and portals/ describe what evaluators and speakers see there.
const portalArg = args.includes('--portal') ? args[args.indexOf('--portal') + 1] : process.env.SB_WEB_PORTAL_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'sessionboard-web-org-portal');
const portal = fs.existsSync(path.join(portalArg, 'src')) ? path.resolve(portalArg) : null;
const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, '..', 'src', 'data', 'ui-labels.json');

const labels = new Map(); // normalized -> { text, sources:Set }
const add = (text, source) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return;
  const key = normalize(t);
  if (!key) return;
  const cur = labels.get(key) || { text: t, sources: new Set() };
  cur.sources.add(source);
  labels.set(key, cur);
};

function walkJson(o, source) {
  if (typeof o === 'string') add(o, source);
  else if (Array.isArray(o)) o.forEach((v) => walkJson(v, source));
  else if (o && typeof o === 'object') Object.values(o).forEach((v) => walkJson(v, source));
}
function* files(dir, exts) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) yield* files(p, exts);
    else if (exts.some((e) => name.endsWith(e))) yield p;
  }
}

// 1. locale bundles
const apps = [{ dir: ui, tag: '' }, ...(portal ? [{ dir: portal, tag: 'portal:' }] : [])];
for (const { dir, tag } of apps) {
  const localeDir = path.join(dir, 'public', 'locales', 'en');
  for (const f of fs.existsSync(localeDir) ? fs.readdirSync(localeDir) : []) {
    if (f.endsWith('.json')) walkJson(JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8')), `${tag}locale:${f}`);
  }
}
// 2. defaultValue and 3. JSX text
const DEFAULT = /defaultValue:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
// Positional default: t('ns.key', 'Label') — the dominant form in web-ui-v2.
const POSITIONAL = /\bt\(\s*(['"])[\w.:-]+\1\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
// Object-literal and JSX-prop labels: `{ title: 'Room conflict' }`, `label: 'Accept'`,
// `title="Filterable Fields for Reviewers"` — menu items, rule definitions, section and
// column headers that never pass through t().
const LITERAL = /\b(?:title|label|name|heading|placeholder)\s*[:=]\s*(['"])([A-Z][^'"\n]{1,60})\1/g;
const JSX_TEXT = />\s*([A-Z][A-Za-z0-9 &/'’+\-]{1,48}?)\s*</g;
for (const { dir, tag } of apps) {
  for (const f of files(path.join(dir, 'src'), ['.tsx', '.ts'])) {
    if (/\.(test|stories)\.tsx?$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(DEFAULT)) add(m[2], `${tag}defaultValue`);
    for (const m of src.matchAll(POSITIONAL)) add(m[3], `${tag}defaultValue`);
    for (const m of src.matchAll(LITERAL)) add(m[2], `${tag}literal`);
    if (f.endsWith('.tsx')) for (const m of src.matchAll(JSX_TEXT)) add(m[1], `${tag}jsx`);
  }
}
// 4. nav manifest
const nav = path.join(here, '..', 'src', 'data', 'nav-manifest.json');
if (fs.existsSync(nav)) {
  const m = JSON.parse(fs.readFileSync(nav, 'utf8'));
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') { if (typeof o.name === 'string') add(o.name, 'nav'); if (typeof o.label === 'string') add(o.label, 'nav'); Object.values(o).forEach(walk); }
  };
  walk(m);
}

const sorted = [...labels.values()].sort((a, b) => a.text.localeCompare(b.text));
fs.writeFileSync(out, JSON.stringify({
  '//': 'Generated by scripts/extract-ui-labels.mjs from sessionboard-web-ui-v2 (locales, t() defaults, object-literal titles/labels, JSX text; plus sessionboard-web-org-portal when present) and nav-manifest.json. Do not edit by hand.',
  generated_at: new Date().toISOString(),
  count: sorted.length,
  labels: sorted.map((l) => l.text)
}, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), out)}: ${sorted.length} labels`);
