#!/usr/bin/env node
/**
 * Draft Community "What's new" posts from the release notes.
 *
 * For every entry that is live in production (both main regions) and has no
 * Community draft yet, builds a changelog entry — title, customer-facing
 * markdown (summary, why use it, who gets it, how to turn it on, link to the
 * guide), type, and the label `release:<id>` that makes the run idempotent —
 * and creates it as a DRAFT through the staff-only Community admin API.
 * Nothing is published: a human reads the draft in the Community console,
 * edits, and publishes (optionally notifying the voters of linked ideas).
 *
 * Customer-facing only. `internal.*` (CS action, talk track, gotchas, staff
 * path) never leaves this script.
 *
 *   node scripts/release-community-draft.mjs                  # dry run: print the drafts, create nothing
 *   SB_API_BASE=https://api.sessionboard.com SB_API_TOKEN=… node scripts/release-community-draft.mjs --push
 *   node scripts/release-community-draft.mjs --since 2026-10-01   # preview a wider window
 *
 * SB_API_TOKEN is a super-user session bearer token (the one the admin app
 * sends; it lives about a day), so this runs from a staff laptop, not CI.
 * POST /community/admin/changelog is super-user-only server-side; the only
 * other credential it accepts is the cross-region community service key,
 * which does not belong in a docs repo. If Josh wants this unattended, the
 * web-api change is an internal API-key path on that router — see AGENTS.md.
 */

import { allEntries, formatDate, isLive, loadReleaseNotes, readSite } from '../src/lib/release-notes.mjs';
import { draftFor as buildDraft, labelFor } from '../src/lib/community-draft.mjs';

const PUSH = process.argv.includes('--push');
const sinceIdx = process.argv.indexOf('--since');
const SINCE = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : null;
const API_BASE = (process.env.SB_API_BASE || '').replace(/\/$/, '');
const TOKEN = process.env.SB_API_TOKEN;

const site = readSite();
const base = `https://${site.canonicalHost}`;
const draftFor = (entry) => buildDraft(entry, base);

const { releases, problems } = loadReleaseNotes();
if (problems.length) {
  console.error(`\n✖ release notes invalid:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const candidates = allEntries(releases).filter((e) => isLive(e) && (!SINCE || e.date >= SINCE));

if (candidates.length === 0) {
  console.log('Nothing live to draft.');
  process.exit(0);
}

async function api(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

/** Labels already used by Community entries, so a re-run never duplicates a draft. */
async function existingLabels() {
  const seen = new Set();
  for (let skip = 0; ; skip += 200) {
    const page = await api(`/community/admin/changelog?limit=200&skip=${skip}`);
    for (const entry of page.entries || []) for (const l of entry.labels || []) seen.add(l);
    if (!page.entries || page.entries.length < 200) break;
  }
  return seen;
}

if (!PUSH) {
  console.log(`Dry run — ${candidates.length} live ${candidates.length === 1 ? 'entry' : 'entries'} would be drafted (pass --push with SB_API_BASE and SB_API_TOKEN to create them):\n`);
  for (const e of candidates) {
    const d = draftFor(e);
    console.log(`─── ${d.title}  [${d.types[0]} · ${e.module} · live ${formatDate(e.shipped.live.us)}]  labels: ${d.labels.join(', ')}`);
    console.log(d.detailsMarkdown.replace(/^/gm, '    '));
    console.log();
  }
  process.exit(0);
}

if (!API_BASE || !TOKEN) {
  console.error('✖ --push needs SB_API_BASE (e.g. https://api.sessionboard.com) and SB_API_TOKEN (a super-user bearer token).');
  process.exit(1);
}

const seen = await existingLabels();
let created = 0;
let skipped = 0;
for (const e of candidates) {
  const d = draftFor(e);
  if (seen.has(labelFor(e))) {
    skipped += 1;
    continue;
  }
  const out = await api('/community/admin/changelog', { method: 'POST', body: JSON.stringify(d) });
  created += 1;
  console.log(`✓ drafted ${out.entry?.id || '?'}  ${d.title}`);
}
console.log(`\n${created} draft${created === 1 ? '' : 's'} created, ${skipped} already existed. Publish them from the Community console.`);
