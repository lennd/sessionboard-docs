#!/usr/bin/env node
/**
 * Drift detector: bold UI labels in articles that the admin app no longer shows.
 *
 *   node scripts/check-labels.mjs            # report, exit 0
 *   node scripts/check-labels.mjs --strict   # exit 1 on any unknown label
 *   node scripts/check-labels.mjs --json     # machine output for the content-refresh queue
 *
 * STYLE.md puts UI labels in bold ("click **Create Form**", "**Settings > Fields**"). Every
 * bold span that looks like a label is normalized and looked up in src/data/ui-labels.json
 * (scripts/extract-ui-labels.mjs). A miss means the product renamed or removed it, or the
 * author guessed — either way the article needs a look. Bold used for emphasis ("**never**
 * delete a field") is filtered by shape: labels are 1–6 words, start with a capital or a
 * digit, carry no sentence punctuation. "A > B > C" paths are checked per segment.
 *
 * This is a detector, not a CI gate by default: label coverage in the app is good but not
 * total (some strings are built at runtime), so the output feeds the refresh queue where an
 * agent confirms against the screen. Articles can allowlist a span with
 * an MDX comment reading `label-ok: Foo` anywhere in the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from './lib/labels.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const DOCS = path.join(here, '..', 'src', 'content', 'docs');
const corpusFile = path.join(here, '..', 'src', 'data', 'ui-labels.json');
const args = process.argv.slice(2);
const strict = args.includes('--strict'), json = args.includes('--json');

if (!fs.existsSync(corpusFile)) { console.error('src/data/ui-labels.json missing — run scripts/extract-ui-labels.mjs --ui <web-ui-v2>'); process.exit(2); }
const corpus = new Set(JSON.parse(fs.readFileSync(corpusFile, 'utf8')).labels.map(normalize));

// Product/brand words that appear bold but are not controls.
const IGNORE = new Set(['sessionboard', 'note', 'tip', 'warning', 'important', 'example', 'examples', 'yes', 'no', 'or', 'and', 'admin', 'admins', 'speaker', 'speakers', 'sponsor', 'sponsors', 'exhibitor', 'exhibitors', 'attendee', 'attendees', 'evaluator', 'evaluators', 'moderator', 'chairperson', 'submitter', 'organizer', 'organizers']);
const looksLikeLabel = (t) => {
  if (!/^[A-Z0-9+]/.test(t)) return false;
  if (/[.!?;:]$/.test(t) || /[.!?]\s/.test(t)) return false; // sentences and "Term:" definitions
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  if (/^\d+(\.\d+)?%?$/.test(t)) return false;
  if (/https?:\/\//.test(t) || /@/.test(t)) return false;
  return true;
};

function* mdx(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) yield* mdx(p);
    else if (/\.mdx?$/.test(n)) yield p;
  }
}

// Historical pages describe labels as they were when shipped; they are not drift.
const SKIP = [/^help\/release-notes$/];
const findings = [];
let spans = 0, checked = 0;
for (const file of mdx(DOCS)) {
  const rel = path.relative(DOCS, file).replace(/\.mdx?$/, '');
  if (SKIP.some((re) => re.test(rel))) continue;
  const src = fs.readFileSync(file, 'utf8').replace(/\{\/\* training-series:start \*\/\}[\s\S]*?\{\/\* training-series:end \*\/\}/, '');
  const ok = new Set([...src.matchAll(/\{\/\*\s*label-ok:\s*([^*]+?)\s*\*\/\}/g)].map((m) => normalize(m[1])));
  const missing = new Map();
  for (const m of src.matchAll(/\*\*([^*\n]{2,80})\*\*/g)) {
    spans++;
    const span = m[1].trim();
    // Paths: "Settings > Fields" — check every segment.
    const parts = span.split(/\s*(?:>|→|›)\s*/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!looksLikeLabel(part)) continue;
      const key = normalize(part);
      if (!key || IGNORE.has(key) || ok.has(key)) continue;
      checked++;
      if (corpus.has(key)) continue;
      // Tolerate a trailing "s" / "button" / "tab" noise word.
      const alt = [key.replace(/\s+(button|tab|page|field|section|toggle|menu|icon|module)$/, ''), key.replace(/s$/, '')];
      if (alt.some((a) => a && corpus.has(a))) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (!missing.has(key)) missing.set(key, { label: part, lines: [] });
      missing.get(key).lines.push(line);
    }
  }
  if (missing.size) findings.push({ article: rel, unknown: [...missing.values()].map((v) => ({ label: v.label, lines: v.lines })) });
}

const total = findings.reduce((n, f) => n + f.unknown.length, 0);
if (json) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), corpus: corpus.size, spans, checked, unknown: total, findings }, null, 2));
} else {
  for (const f of findings) {
    console.log(`${f.article}`);
    for (const u of f.unknown) console.log(`  L${u.lines.join(',')}  **${u.label}**`);
  }
  console.log(`\n${spans} bold spans, ${checked} label-shaped, ${total} not found in the app (${findings.length} articles). Corpus: ${corpus.size} labels.`);
}
if (strict && total) process.exit(1);
