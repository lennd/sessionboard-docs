#!/usr/bin/env node
/**
 * Enforce the mechanical half of STYLE.md.
 *
 * These are all defects the HubSpot migration produced in bulk — a linkless copy
 * of the page's own headings pasted at the top, alt text that just repeats the
 * title, pages starting at h3, "How to ...?" titles that are not questions. They
 * were fixed once. Without a gate they come back the next time someone pastes
 * from the old KB, and nobody notices until a page looks wrong in production.
 *
 * Prose style (terminology, voice) is Vale's job. This covers only what Vale
 * cannot see: frontmatter, document structure, and image markup.
 *
 *   node scripts/check-style.mjs
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = 'src/content/docs';
const files = globSync(`${DOCS}/**/*.mdx`);

/** Titles may exceed this only if a short sidebar label is supplied. */
const TITLE_SOFT_MAX = 48;

const problems = [];
const add = (file, rule, msg) => problems.push({ file: file.replace(`${DOCS}/`, ''), rule, msg });

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Documentation is read by prospects and by customers deciding how much to
// trust the product. A page that volunteers "this isn't finished" costs us more
// than the reader gains, and it dates badly — the caveat outlives the gap.
// Describe what the product does; route genuine gaps to support instead.
//
// Scoped to claims about our own maturity: "not supported in Swapcard" is a
// fact about Swapcard, and "if your organization doesn't have access yet" is
// about their plan. Both are fine and must stay lintable-clean.
const READINESS = /\b(available|usable|supported|ready|reliable|reported|implemented|built|live|working|finished|functional|complete|possible|wired|hooked)\b/i;
const NEGATION = /\b(not|isn'?t|aren'?t|doesn'?t|don'?t|can'?t|cannot|won'?t)\b/i;

const UNSHIPPED = [
  [/\bcoming soon\b/i, 'coming soon'],
  [/\bwork in progress\b/i, 'work in progress'],
  [/\bunder (development|construction)\b/i, 'under development'],
  [/\bstill being (built|finished|shaped|developed|worked)\b/i, 'still being built'],
  [/\brough edges?\b/i, 'rough edges'],
  [/\bhalf[- ]?(baked|built|finished)\b/i, 'half-baked'],
  [/\bnot fully (implemented|supported|built|working|wired)\b/i, 'not fully implemented'],
  [/\bin a future release\b/i, 'in a future release'],
  [/\bon the roadmap\b/i, 'on the roadmap'],
  [/\b(TODO|TBD)\b/, 'TODO/TBD'],
];

/** Sentences that tell the reader a Sessionboard capability is unfinished. */
function unshippedClaims(body) {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')       // code samples
    .replace(/^import .*$/gm, ' ');
  const hits = [];
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim();
    if (!s) continue;
    for (const [re, label] of UNSHIPPED) {
      if (re.test(s)) hits.push([label, s]);
    }
    if (/\byet\b/i.test(s) && NEGATION.test(s) && READINESS.test(s)) {
      hits.push(['"not ... yet"', s]);
    }
    // "You can't do X at this time" promises X is coming and dates the page the
    // moment it doesn't. State the limitation plainly instead. Left alone when
    // it means "at this point in the process", which has no negation.
    if (/\bat (this time|the moment)\b/i.test(s) && (NEGATION.test(s) || /\bonly\b/i.test(s))) {
      hits.push(['"at this time"', s]);
    }
    if (/\bnot currently\b/i.test(s)) hits.push(['"not currently"', s]);
  }
  return hits;
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    add(file, 'frontmatter', 'no frontmatter block');
    continue;
  }
  const [, fm, body] = fmMatch;

  const title = (fm.match(/^title:\s*"?(.*?)"?\s*$/m) || [])[1] || '';
  const label = (fm.match(/^sidebar:\s*\n\s*label:\s*"?(.*?)"?\s*$/m) || [])[1] || '';
  const description = (fm.match(/^description:\s*"?(.*?)"?\s*$/m) || [])[1] || '';

  if (!title) add(file, 'title', 'missing title');
  if (!description) add(file, 'description', 'missing description');

  for (const [label, sentence] of unshippedClaims(`${description}\n${body}`)) {
    add(file, 'unshipped', `${label} — describe what works instead: ${sentence.slice(0, 120)}`);
  }

  // "How to X?" is a statement wearing a question mark. Either ask a real
  // question or use the imperative — STYLE.md prefers the imperative.
  if (/^how to\b/i.test(title) && title.trim().endsWith('?')) {
    add(file, 'title', `"How to ...?" is not a question — use the imperative: ${title}`);
  }

  // Long titles are fine in search results but wreck the sidebar, so they need
  // a short label. This is why most titles have no label: they don't need one.
  if (title.length > TITLE_SOFT_MAX && !label) {
    add(file, 'title', `title is ${title.length} chars and has no sidebar label: ${title}`);
  }

  // A description that stops on a function word was truncated by the migration.
  // "to" and "in" are excluded: they end plenty of valid sentences as particles
  // ("linked to", "built in"), and flagging those trains people to ignore this.
  if (description && /\b(that|the|and|with|for|of|is|are|will|can|a|an)\.?$/i.test(description.trim().replace(/\.$/, ''))) {
    add(file, 'description', `description ends mid-thought: ...${description.slice(-48)}`);
  }

  const prose = body.replace(/```[\s\S]*?```/g, '');

  // Starlight renders its own table of contents, so a bullet list of the page's
  // own headings is duplication left over from HubSpot's jump links.
  const headings = [...prose.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)];
  const headingSet = new Set(headings.map((h) => norm(h[2])));
  for (const [block] of prose.matchAll(/((?:^[-*] [^\n]+\n){2,})/gm)) {
    const items = block.trim().split('\n').map((l) => l.replace(/^[-*]\s+/, '').trim());
    if (items.some((i) => i.includes(']('))) continue;
    const matched = items.filter((i) => headingSet.has(norm(i))).length;
    if (matched >= 2 && matched / items.length >= 0.6) {
      add(file, 'toc', `bullet list repeats the page's own headings: ${items.slice(0, 3).join(' / ')}`);
      break;
    }
  }

  // The H1 comes from the title, so the first body heading is h2.
  if (headings.length && headings[0][1].length > 2) {
    add(file, 'headings', `first heading is ${headings[0][1]} — should be ##: ${headings[0][2]}`);
  }

  for (const [, alt] of body.matchAll(/!\[([^\]]*)\]\(/g)) {
    const a = alt.trim();
    if (!a) {
      add(file, 'alt', 'image has empty alt text');
    } else if (/\bin Sessionboard$/.test(a) && title && a.startsWith(title.slice(0, 20))) {
      add(file, 'alt', `alt text just repeats the title: ${a}`);
    } else if (/^(image|screenshot|screen shot|img)[\s_.-]|^[a-f0-9]{8,}/i.test(a)) {
      add(file, 'alt', `alt text is a filename, not a description: ${a}`);
    } else if (/\(\d+\)$/.test(a)) {
      // A run of screenshots under one heading used to be numbered off that
      // heading. "(2)" tells a screen reader nothing — describe the image.
      add(file, 'alt', `alt text is a numbered duplicate, not a description: ${a}`);
    } else if (/^[^\p{L}\p{N}"'“‘([]/u.test(a)) {
      add(file, 'alt', `alt text starts with a symbol or emoji: ${a}`);
    } else if (a.includes(':')) {
      // HubSpot prefixed every image with the page title. Renaming a page leaves
      // that prefix behind pointing at a title that no longer exists anywhere.
      const prefix = a.split(':')[0].trim();
      if (prefix.length > 24 && prefix.toLowerCase() !== title.toLowerCase()) {
        add(file, 'alt', `alt text is prefixed with a stale page title: ${a}`);
      }
    }
  }
}

if (!problems.length) {
  console.log(`Style check passed: ${files.length} pages.`);
  process.exit(0);
}

const byRule = problems.reduce((acc, p) => ((acc[p.rule] ??= []).push(p), acc), {});
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`\n${rule} (${list.length})`);
  for (const p of list) console.log(`  ${p.file}\n     ${p.msg}`);
}
console.log(`\n${problems.length} style problems across ${new Set(problems.map((p) => p.file)).size} pages.`);
console.log('See STYLE.md. These are all migration artifacts — fix the page, do not relax the rule.');
process.exit(1);
