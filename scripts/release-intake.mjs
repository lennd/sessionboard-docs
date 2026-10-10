#!/usr/bin/env node
/**
 * Turn a merged product PR into a release-notes draft — or a recorded "skip".
 *
 * This is the "analyzed for updates" half of real-time release notes. The
 * product repos announce each merge into `main` with a `repository_dispatch`
 * (event `pr-merged`, see their notify-docs-release.yml); the release-intake
 * workflow here runs this script, which:
 *
 *   1. reads the PR (title, body, labels, changed files) with the PAT the
 *      daily job already carries;
 *   2. asks Claude whether the change is something a Sessionboard user can
 *      see and, if so, drafts the full entry — every field AGENTS.md requires,
 *      pointed at the guide that covers it (the model is given the article
 *      index, the module list and the feature slugs);
 *   3. validates the draft with the same `validateEntry` CI uses and writes it
 *      into src/data/release-notes/<today>.json, flagged under
 *      `internal.draft` so a reviewer can see it was machine-written;
 *   4. updates the ledger (_intake.json): `drafted` with the review PR filled
 *      in by the workflow, or `skip` with the model's reason (decided_by: claude).
 *
 * A draft is never published by this script: the workflow opens a pull
 * request, Docs CI runs release:check on it, and a person merges. Skips go
 * straight to the ledger — they are auditable there and `release-gaps`
 * surfaces them — because a wrong skip costs a missed note, not a wrong one
 * in front of customers.
 *
 *   node scripts/release-intake.mjs --pr lennd/sessionboard-web-api#4433 [--pr …]
 *   node scripts/release-intake.mjs --pending [--limit 20]    # triage the ledger backlog
 *   node scripts/release-intake.mjs --event "$GITHUB_EVENT_PATH"  # repository_dispatch payload
 *   node scripts/release-intake.mjs --mark-drafted --draft-pr URL --pr …  # after the review PR exists
 *   node scripts/release-intake.mjs --collect-drafts <git ref>   # drafts on a branch that main lacks → JSON
 *   node scripts/release-intake.mjs --apply-drafts FILE [--apply-drafts FILE]  # append drafts to the day files
 *   --dry-run prints the model's answer and writes nothing.
 *
 * The workflow keeps ONE review branch, release-intake/drafts, rebuilt on
 * every run as origin/main + every draft not yet merged (--collect-drafts from
 * the old branch, --apply-drafts onto a fresh checkout of main). A branch that
 * is always "main plus drafts" cannot conflict, and one rolling PR is a review
 * queue rather than thirty PRs a day.
 *
 * Env: ANTHROPIC_API_KEY (required unless --dry-run with --no-model),
 *      RELEASE_INTAKE_MODEL (default claude-sonnet-4-6),
 *      GH_RELEASE_STATUS_TOKEN / GITHUB_TOKEN / `gh auth token`.
 * Writes a machine summary to $RELEASE_INTAKE_RESULT (default /tmp/release-intake-result.json).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  AUDIENCES,
  AVAILABILITY,
  CS_ACTION,
  DATA_DIR,
  DOCS_DIR,
  ENABLE_HOW,
  KINDS,
  MODULES,
  SCOPES,
  allEntries,
  featureFacts,
  loadReleaseNotes,
  readContract,
  validateEntry,
} from '../src/lib/release-notes.mjs';
import { gh, parsePrRef, releaseConfig, requireToken } from '../src/lib/github-api.mjs';
import { loadIntake, saveIntake, recordFor, heuristicSkip } from './release-gaps.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const value = (name, fallback) => values(name)[0] ?? fallback;

const DRY = flag('--dry-run');
const NO_MODEL = flag('--no-model');
const MARK = flag('--mark-drafted');
const COLLECT = value('--collect-drafts', null);
const APPLY = values('--apply-drafts');
const LIMIT = Number(value('--limit', 25));
const MODEL = process.env.RELEASE_INTAKE_MODEL || 'claude-sonnet-4-6';
const RESULT_FILE = process.env.RELEASE_INTAKE_RESULT || '/tmp/release-intake-result.json';
const TODAY = new Date().toISOString().slice(0, 10);

const config = releaseConfig();
const contract = readContract();
const token = requireToken();

// ── which PRs ──────────────────────────────────────────────────────────────

function refsFromArgs() {
  const refs = values('--pr').map((r) => parsePrRef(r, config)).filter(Boolean);
  const eventPath = value('--event', null);
  if (eventPath && existsSync(eventPath)) {
    const ev = JSON.parse(readFileSync(eventPath, 'utf8'));
    const pr = ev.client_payload?.pr || ev.inputs || {};
    const ref = pr.ref || (pr.repo && pr.number ? `${pr.repo}#${pr.number}` : null);
    const parsed = ref && parsePrRef(ref, config);
    if (parsed) refs.push(parsed);
  }
  if (flag('--pending')) {
    const intake = loadIntake();
    for (const [ref, rec] of Object.entries(intake.prs)) {
      if (rec.decision !== 'pending') continue;
      const parsed = parsePrRef(ref, config);
      if (parsed) refs.push(parsed);
      if (refs.length >= LIMIT) break;
    }
  }
  const seen = new Set();
  return refs.filter((r) => (seen.has(r.ref) ? false : (seen.add(r.ref), true)));
}

// ── context the model needs ────────────────────────────────────────────────

function frontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

function articleIndex() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith('.mdx')) {
        const src = readFileSync(p, 'utf8');
        const fm = frontmatter(src);
        const path = `/${relative(DOCS_DIR, p).replace(/\.mdx$/, '').replace(/\/index$/, '')}`;
        if (path.startsWith('/help/release-notes')) continue;
        const headings = [...src.matchAll(/^##\s+(.+?)\s*$/gm)].map((h) => h[1]).slice(0, 12);
        out.push({ path, title: fm.title || path, description: fm.description || '', features: fm.features || '', headings });
      }
    }
  };
  walk(DOCS_DIR);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function featureIndex() {
  return contract.features
    .map((slug) => featureFacts(slug, contract))
    .filter((f) => f.lifecycle !== 'retired' && f.lifecycle !== 'merged')
    .map((f) => `${f.slug} — ${f.name}${f.availability !== 'everyone' ? ` (${f.availability})` : ''}`);
}

function exampleEntry() {
  const { releases } = loadReleaseNotes();
  const e = allEntries(releases).find((x) => x.date >= '2026-10-07' && x.use_case && x.internal?.when_to_bring_up);
  if (!e) return null;
  const { date, ...rest } = e;
  rest.shipped = { prs: rest.shipped.prs, docs_only: false, live: { us: null, eu: null, me: null } };
  return rest;
}

async function fetchPr(p) {
  const pr = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}`, { token });
  let files = [];
  try {
    files = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}/files?per_page=100`, { token });
  } catch {
    files = [];
  }
  return { pr, files };
}

const SYSTEM = `You write release notes for Sessionboard, an event-management platform (speaker and session management, awards, CFP, portals, CRM, marketing, program sites). You read one merged pull request and decide whether it changed something a Sessionboard *user* — an organizer, reviewer, speaker or participant — can see or do. Internal tooling, staff-only consoles, tests, CI, refactors, performance work with no visible behaviour change, and prototype/demo-only code are NOT user-visible: answer with a skip.

If it is user-visible, draft ONE release entry as JSON that follows the schema exactly. Rules:
- Write for a customer. Plain, specific sentences. Bold the exact UI labels the PR introduces or renames. No marketing adjectives, no "we".
- The products are named Dispatch and Advocacy — never "Amplify" in anything a human reads.
- "article" MUST be a path from the article index you are given, optionally with "#" + one of its listed headings turned into a slug (lowercase, spaces → hyphens, punctuation removed). Choose the guide that documents the surface the PR changed. If no guide covers it, still pick the closest one and set "docs_gap" to one sentence saying what the guide should add.
- "features" are slugs from the feature list, only when the change belongs to that feature.
- "permissions" are exact slugs from the permission list (e.g. event.contacts.read) that a user must hold to use the change. Leave it [] unless the PR names a permission check; never write prose there.
- "kind": new = a capability that did not exist; improved = an existing capability does more or reads better; fixed = behaviour that was wrong now works.
- "use_case": one or two sentences a customer success manager could say to a customer about why they would want this.
- "internal" is for staff only: cs_action.kind ∈ ${Object.keys(CS_ACTION).join(' | ')}; when_to_bring_up, who_should_get_it, gotchas, talk_track are short sentences.
- "enable.path" is the menu path to turn it on (omit when it is on for everyone by default); "where.path" is the menu path where the change shows up.
- "where.scope" ∈ ${SCOPES.join(' | ')}; "audience" ⊆ ${AUDIENCES.join(', ')}; "module" ∈ ${MODULES.join(' | ')}.
- "id" is a short kebab-case slug unique to this change.
- Do not invent facts that are not in the PR. If the PR body has a QA or Problem/Solution section, trust it over the diff file list.

Answer with JSON only, no prose, in one of these two shapes:
{"decision":"skip","reason":"<one sentence>"}
{"decision":"entry","confidence":"high|medium|low","docs_gap":"<sentence or null>","entry":{ ... }}`;

/** 246 slugs folded to one line per resource: `event.contacts: create, delete, export, read, update`. */
function permissionIndex() {
  const groups = new Map();
  for (const slug of contract.permissions || []) {
    const i = slug.lastIndexOf('.');
    const [res, action] = i > 0 ? [slug.slice(0, i), slug.slice(i + 1)] : [slug, ''];
    if (!groups.has(res)) groups.set(res, []);
    if (action) groups.get(res).push(action);
  }
  return [...groups].map(([res, actions]) => `${res}: ${actions.join(', ')}`).join('\n');
}

function userPrompt({ pr, files, p, articles, features, example }) {
  const fileList = files
    .slice(0, 80)
    .map((f) => `${f.status[0]} ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');
  return [
    `# Pull request ${p.ref}`,
    `Title: ${pr.title}`,
    `Author: ${pr.user?.login}  Merged: ${pr.merged_at}  Labels: ${(pr.labels || []).map((l) => l.name).join(', ') || '—'}`,
    `URL: ${pr.html_url}`,
    '',
    '## Body',
    (pr.body || '(empty)').slice(0, 12000),
    '',
    `## Changed files (${files.length})`,
    fileList || '(unavailable)',
    '',
    '## Entry schema (fill every field; shipped.prs must be exactly this PR)',
    JSON.stringify(
      {
        id: 'kebab-case-slug',
        title: 'What the user can now do, as a headline',
        summary: 'One or two sentences; **bold** UI labels; markdown bold/code/links only.',
        article: '/folder/guide#section-slug',
        related: ['/other/guide'],
        kind: KINDS.join(' | '),
        module: MODULES.join(' | '),
        features: ['feature_slug'],
        availability: `${Object.keys(AVAILABILITY).join(' | ')} (omit to derive from the feature)`,
        enable: { how: Object.keys(ENABLE_HOW).join(' | '), path: 'Menu → Path (omit when default_on)' },
        where: { scope: SCOPES.join(' | '), path: 'Menu → Path where it shows up' },
        permissions: [],
        audience: AUDIENCES,
        use_case: '…',
        internal: {
          cs_action: { kind: Object.keys(CS_ACTION).join(' | '), note: '… or null' },
          when_to_bring_up: '…',
          who_should_get_it: '…',
          staff_path: '… or null',
          gotchas: '… or null',
          talk_track: '… or null',
        },
        shipped: { prs: [p.ref], docs_only: false, live: { us: null, eu: null, me: null } },
      },
      null,
      1,
    ),
    '',
    '## A finished entry, for tone and depth',
    example ? JSON.stringify(example, null, 1) : '(none)',
    '',
    '## Feature slugs',
    features.join('\n'),
    '',
    '## Permission slugs (scope.resource: actions)',
    permissionIndex(),
    '',
    '## Article index (path | title | h2 headings)',
    articles.map((a) => `${a.path} | ${a.title} | ${a.headings.join('; ')}`).join('\n'),
  ].join('\n');
}

/**
 * The answer comes back as a forced tool call, so the model never has to hand-escape
 * JSON inside a text block (three of the first fifteen drafts died on a stray quote).
 * The schema is deliberately loose on `entry`; validateEntry is the real gate.
 */
const DECISION_TOOL = {
  name: 'release_decision',
  description: 'Record whether the pull request is user-visible and, if so, the drafted release entry.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['skip', 'entry'] },
      reason: { type: 'string', description: 'skip only: one sentence' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      docs_gap: { type: ['string', 'null'] },
      entry: { type: 'object', additionalProperties: true },
    },
  },
};

async function askModel(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0,
      system,
      tools: [DECISION_TOOL],
      tool_choice: { type: 'tool', name: DECISION_TOOL.name },
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const call = (data.content || []).find((c) => c.type === 'tool_use' && c.name === DECISION_TOOL.name);
  if (call && call.input && typeof call.input === 'object') return call.input;
  // A stub or an older model may still answer in text; take the first JSON object in it.
  const text = (data.content || []).map((c) => c.text || '').join('');
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = json.indexOf('{');
  if (start < 0) throw new Error(`model returned no decision (stop_reason ${data.stop_reason})`);
  return JSON.parse(json.slice(start));
}

// ── writing ────────────────────────────────────────────────────────────────

function releaseFile(date) {
  const file = join(DATA_DIR, `${date}.json`);
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { date, entries: [] };
  return { file, data };
}

function uniqueId(base, taken) {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function cleanEntry(raw, p, meta) {
  const e = { ...raw };
  e.shipped = { prs: [p.ref], docs_only: false, live: { us: null, eu: null, me: null } };
  if (e.enable && e.enable.path == null && e.enable.how === 'default_on') delete e.enable.path;
  if (e.availability && !AVAILABILITY[e.availability]) delete e.availability;
  // Permissions are contract slugs (event.contacts.read …). The model tends to write
  // prose here; keep the prose for the reviewer instead of shipping a validation problem.
  const known = new Set(contract.permissions || []);
  const dropped = (Array.isArray(e.permissions) ? e.permissions : []).filter((x) => !known.has(x));
  e.permissions = (Array.isArray(e.permissions) ? e.permissions : []).filter((x) => known.has(x));
  const draft = { by: 'release-intake', model: MODEL, confidence: meta.confidence || null, docs_gap: meta.docs_gap || null, at: new Date().toISOString() };
  if (dropped.length) draft.permissions_to_confirm = dropped;
  e.internal = { ...(e.internal || {}), draft };
  return e;
}

// ── draft branch plumbing ──────────────────────────────────────────────────

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** Entries with `internal.draft` on `ref` whose id main does not have → [{ date, entry }]. */
function collectDrafts(ref) {
  const onMain = new Set(allEntries(loadReleaseNotes().releases).map((e) => e.id));
  let names;
  try {
    names = git('ls-tree', '--name-only', ref, 'src/data/release-notes/').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const out = [];
  for (const path of names) {
    const base = path.split('/').pop();
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(base);
    if (!m) continue;
    let data;
    try {
      data = JSON.parse(git('show', `${ref}:${path}`));
    } catch {
      continue;
    }
    for (const entry of data.entries || []) {
      if (entry.internal?.draft && !onMain.has(entry.id)) out.push({ date: m[1], entry });
    }
  }
  return out;
}

/** Append drafts to their day files (creating the file when needed); ids already present are left alone. */
function applyDrafts(lists) {
  const byDate = new Map();
  for (const list of lists) {
    const items = Array.isArray(list) ? list : list.drafts || [];
    for (const { date, entry } of items) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(entry);
    }
  }
  let added = 0;
  for (const [date, entries] of byDate) {
    const { file, data } = releaseFile(date);
    const have = new Set(data.entries.map((e) => e.id));
    for (const e of entries) {
      if (have.has(e.id)) continue;
      data.entries.push(e);
      have.add(e.id);
      added++;
    }
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return added;
}

if (COLLECT) {
  console.log(JSON.stringify(collectDrafts(COLLECT), null, 2));
  process.exit(0);
}
if (APPLY.length) {
  const lists = APPLY.filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const added = applyDrafts(lists);
  console.log(`Applied ${added} draft(s) from ${APPLY.length} file(s).`);
  process.exit(0);
}

// ── main ───────────────────────────────────────────────────────────────────

const refs = refsFromArgs();
if (!refs.length) {
  console.error('Nothing to do: pass --pr lennd/<repo>#<n>, --pending, or --event <path>.');
  process.exit(0);
}

const intake = loadIntake();
const result = { drafted: [], skipped: [], problems: [], drafts: [], entries_file: null, refs: refs.map((r) => r.ref) };

if (MARK) {
  const url = value('--draft-pr', null);
  for (const p of refs) {
    const rec = intake.prs[p.ref];
    if (!rec) continue;
    rec.decision = 'drafted';
    rec.draft_pr = url;
    rec.decided_by = 'release-intake';
  }
  if (!DRY) saveIntake(intake);
  console.log(`Marked ${refs.length} PR(s) drafted → ${url}`);
  process.exit(0);
}

const articles = articleIndex();
const features = featureIndex();
const example = exampleEntry();
const { data: release, file: releasePath } = releaseFile(TODAY);
const taken = new Set(allEntries(loadReleaseNotes().releases).map((e) => e.id));
let wroteEntries = false;

for (const p of refs) {
  let pr;
  let files;
  try {
    ({ pr, files } = await fetchPr(p));
  } catch (err) {
    result.problems.push(`${p.ref}: ${err.message}`);
    continue;
  }
  if (!pr.merged_at) {
    result.problems.push(`${p.ref}: not merged — ignoring`);
    continue;
  }
  const rec = intake.prs[p.ref] || { ...recordFor(pr, p.owner, p.repo), decision: 'pending', seen_at: TODAY };
  intake.prs[p.ref] = rec;
  if (rec.decision === 'entry' || rec.decision === 'drafted') {
    console.log(`${p.ref}: already ${rec.decision}${rec.entry_id ? ` (${rec.entry_id})` : ''} — skipping`);
    continue;
  }
  if (rec.decision === 'skip' && rec.decided_by !== 'heuristic') {
    console.log(`${p.ref}: skipped by ${rec.decided_by || 'a person'} — leaving it`);
    continue;
  }
  const why = heuristicSkip(pr);
  if (why && rec.decision !== 'skip') {
    rec.decision = 'skip';
    rec.reason = why;
    rec.decided_by = 'heuristic';
    result.skipped.push({ ref: p.ref, reason: why });
    console.log(`${p.ref}: skip — ${why}`);
    continue;
  }

  if (NO_MODEL) {
    console.log(`${p.ref}: would ask ${MODEL} (--no-model)`);
    continue;
  }
  let answer;
  try {
    answer = await askModel(SYSTEM, userPrompt({ pr, files, p, articles, features, example }));
  } catch (err) {
    result.problems.push(`${p.ref}: model — ${err.message}`);
    console.error(`${p.ref}: model failed — ${err.message}`);
    continue;
  }
  if (DRY) console.log(`\n${p.ref} →\n${JSON.stringify(answer, null, 2)}\n`);

  if (answer.decision === 'skip') {
    rec.decision = 'skip';
    rec.reason = answer.reason || 'not user-visible (model)';
    rec.decided_by = 'claude';
    result.skipped.push({ ref: p.ref, reason: rec.reason });
    console.log(`${p.ref}: skip — ${rec.reason}`);
    continue;
  }
  // The tool schema says `entry` is an object, but the model sometimes hands it over
  // as a JSON string; spreading that gives an entry of single characters (run 2, 3 PRs).
  if (typeof answer.entry === 'string') {
    try {
      answer.entry = JSON.parse(answer.entry);
    } catch (err) {
      result.problems.push(`${p.ref}: entry was a string that is not JSON — ${err.message}`);
      continue;
    }
  }
  if (answer.decision !== 'entry' || !answer.entry || typeof answer.entry !== 'object' || Array.isArray(answer.entry)) {
    result.problems.push(`${p.ref}: model returned neither skip nor entry`);
    continue;
  }

  const entry = cleanEntry(answer.entry, p, answer);
  entry.id = uniqueId(String(entry.id || p.repo + '-' + p.number).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), taken);
  taken.add(entry.id);
  const problems = validateEntry(entry, TODAY, contract, { file: `src/data/release-notes/${TODAY}.json` });
  if (problems.length) {
    // Keep the draft — the review PR shows the problems and CI blocks the merge
    // until a person fixes them. Dropping it would hide the gap again.
    result.problems.push(...problems);
    entry.internal.draft.problems = problems;
  }
  release.entries.push(entry);
  result.drafts.push({ date: TODAY, entry });
  wroteEntries = true;
  rec.decision = 'drafted';
  rec.draft_pr = null;
  rec.entry_id = entry.id;
  rec.decided_by = 'release-intake';
  result.drafted.push({ ref: p.ref, id: entry.id, confidence: answer.confidence || null, docs_gap: answer.docs_gap || null, problems });
  console.log(`${p.ref}: drafted ${entry.id} (${answer.confidence || '?'})${answer.docs_gap ? ` — docs gap: ${answer.docs_gap}` : ''}`);
}

if (!DRY) {
  if (wroteEntries) {
    writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
    result.entries_file = relative(process.cwd(), releasePath);
  }
  saveIntake(intake);
  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
}
console.log(`\n${result.drafted.length} drafted, ${result.skipped.length} skipped, ${result.problems.length} problem(s).${DRY ? ' (dry run — nothing written)' : ''}`);
