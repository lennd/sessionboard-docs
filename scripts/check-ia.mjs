#!/usr/bin/env node
/**
 * IA check: the Help Center's sidebar mirrors the product's sidebar.
 *
 *   node scripts/check-ia.mjs            # human report; exit 1 on a hard failure
 *   node scripts/check-ia.mjs --json     # machine output for the content-refresh queue
 *
 * src/data/nav-manifest.json is generated from the API's org/event navigation layouts. Two
 * rules, checked here so a renamed or new module shows up as a red build, not as a reader
 * who cannot find the group:
 *
 *   1. Every module (Program, CRM, Marketing, CMS, …) has a sidebar group with the same
 *      label, or an alias in src/data/ia-aliases.json pointing at the group or article that
 *      covers it — a hard failure otherwise. Flat and footer entries (Reports, Automations,
 *      Event Team, Settings, Workflows, …) are held to the same lookup but an uncovered one is
 *      reported as a gap, since several are single pages rather than groups. Feature-gated
 *      modules (`feature_id` present: Learning, Attend) are reported, not failed, until GA.
 *   2. Every nav link (leaf item) is *covered*: at least one article's title, description or
 *      body names it. Uncovered links are reported as gaps (never a hard failure — the queue
 *      turns them into "write the article" work).
 *
 * Together with nav:check (the sidebar article names every module and link) this is the
 * mechanical half of "the IA reflects the product". Whether the article under a group is any
 * good is the agent's half.
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(here, '..');
const DOCS = path.join(ROOT, 'src', 'content', 'docs');
const json = process.argv.includes('--json');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'nav-manifest.json'), 'utf8'));
const sidebar = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'sidebar.json'), 'utf8'));
const aliasFile = path.join(ROOT, 'src', 'data', 'ia-aliases.json');
const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : {};

// ---- sidebar groups and article corpus ----
const groups = new Map(); // label -> slugs[]
(function walk(node, trail) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, trail));
  if (!node || typeof node !== 'object') return;
  if (node.label && Array.isArray(node.items)) {
    const slugs = [];
    (function collect(n) { if (Array.isArray(n)) return n.forEach(collect); if (n?.slug) slugs.push(n.slug); if (n?.items) collect(n.items); })(node.items);
    groups.set(node.label, slugs);
    walk(node.items, [...trail, node.label]);
  }
})(sidebar, []);

const articles = new Map(); // slug -> { title, text }
(function read(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) read(p);
    else if (/\.mdx?$/.test(n)) {
      const src = fs.readFileSync(p, 'utf8');
      const fm = src.match(/^---\n([\s\S]*?)\n---/);
      const title = fm?.[1].match(/(?:^|\n)title:\s*["']?(.+?)["']?\s*$/m)?.[1] || '';
      articles.set(path.relative(DOCS, p).replace(/\.mdx?$/, ''), { title, text: src.toLowerCase() });
    }
  }
})(DOCS);

// ---- rule 1: modules and flat/footer entries have a group ----
const entries = [];
for (const scope of ['org', 'event']) {
  const m = manifest[scope] || {};
  for (const mod of m.modules || []) entries.push({ scope, kind: 'module', id: mod.id, name: mod.name, gated: !!mod.feature_id, items: (mod.sections || []).flatMap((s) => s.items || []) });
  for (const key of ['flat', 'footer']) for (const it of m[key] || []) entries.push({ scope, kind: key, id: it.id, name: it.name, gated: !!it.feature_id, items: [it] });
}
const groupFor = (name) => {
  if (groups.has(name)) return { group: name };
  const a = aliases[name];
  if (!a) return null;
  if (groups.has(a)) return { group: a };
  if (articles.has(a)) return { article: a };
  return { broken: a };
};
const failures = [], gated = [], mapped = [], entryGaps = [];
const seen = new Set();
for (const e of entries) {
  if (seen.has(e.name)) continue; seen.add(e.name);
  const g = groupFor(e.name);
  if (g && !g.broken) { mapped.push({ name: e.name, ...g }); continue; }
  const msg = g?.broken ? `${e.name}: alias "${g.broken}" is neither a sidebar group nor an article` : `${e.name} (${e.scope} ${e.kind}): no sidebar group and no alias in src/data/ia-aliases.json`;
  if (g?.broken) failures.push(msg);
  else if (e.gated) gated.push(msg);
  else if (e.kind === 'module') failures.push(msg);
  else entryGaps.push(msg);
}

// ---- rule 2: every nav link is named by at least one article ----
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const gaps = [], covered = [];
const seenItems = new Set();
for (const e of entries) for (const it of e.items) {
  if (!it.name || it.dynamic || seenItems.has(`${e.scope}:${it.id}`)) continue;
  seenItems.add(`${e.scope}:${it.id}`);
  if (/^(overview|dashboard|history|community|preview|training)$/i.test(it.name)) continue; // chrome, not a feature
  const needle = norm(it.name);
  const hits = [...articles.entries()].filter(([, a]) => norm(a.title).includes(needle) || a.text.includes(`**${needle}**`) || a.text.includes(`> ${needle}`) || a.text.includes(`${needle} tab`) || a.text.includes(`${needle} page`)).map(([slug]) => slug);
  if (hits.length) covered.push({ scope: e.scope, module: e.name, item: it.name, articles: hits.slice(0, 5) });
  else gaps.push({ scope: e.scope, module: e.name, item: it.name, id: it.id, gated: e.gated });
}

if (json) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), groups: [...groups.keys()], mapped, failures, gated, entry_gaps: entryGaps, covered: covered.length, gaps }, null, 2));
} else {
  for (const f of failures) console.error(`FAIL  ${f}`);
  for (const g of gated) console.log(`gated ${g}`);
  for (const g of entryGaps) console.log(`gap   ${g}`);
  console.log(`\n${mapped.length} nav entries map to a sidebar group or article; ${covered.length} nav links covered by an article; ${gaps.length} not named anywhere:`);
  for (const g of gaps) console.log(`  gap   ${g.scope}/${g.module} › ${g.item}${g.gated ? '  (feature-gated)' : ''}`);
}
process.exit(failures.length ? 1 : 0);
