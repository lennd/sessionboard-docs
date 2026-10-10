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
import { SENTENCE_SPLIT, sentenceClaims } from '../src/lib/unshipped.mjs';
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
- "why_use_it": the long form of use_case — two to four sentences addressed to the customer ("you"), saying what problem this solves and when they would reach for it. It becomes the "## Why use it" section of the linked article, so it must stand on its own without the release entry. Describe what the product does; never say it is unfinished.
- "internal" is for staff only: cs_action.kind ∈ ${Object.keys(CS_ACTION).join(' | ')}; when_to_bring_up, who_should_get_it, gotchas, talk_track are short sentences.
- "enable.path" is the menu path to turn it on, and it is REQUIRED unless enable.how is default_on. For support or csm write "Ask your Customer Success Manager to enable <feature>; then <where.path>"; for self_serve write "Get started → Early Access → Preview → <feature>". "where.path" is the menu path where the change shows up.
- "where.scope" ∈ ${SCOPES.join(' | ')}; "audience" ⊆ ${AUDIENCES.join(', ')}; "module" ∈ ${MODULES.join(' | ')}.
- "id" is a short kebab-case slug unique to this change.
- Never write an email address, URL with a token, or any secret in any field — say "Sessionboard Support" instead of a support address.
- Do not invent facts that are not in the PR. If the PR body has a QA or Problem/Solution section, trust it over the diff file list.

Answer by calling the release_decision tool. A skip is {"decision":"skip","reason":"<one sentence>"}. An entry is {"decision":"entry","confidence":"high|medium|low","docs_gap":"<sentence or null>", ...} with every entry field (id, title, summary, article, kind, where, use_case, internal, …) given as a structured value at the top level of the tool input — never as a JSON string.`;

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
    '## Entry fields (fill every one, each as a top-level tool-input field; shipped is set for you)',
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
const ENTRY_PROPERTIES = {
  id: { type: 'string', description: 'kebab-case slug unique to this change' },
  title: { type: 'string' },
  summary: { type: 'string' },
  article: { type: 'string', description: '/folder/guide or /folder/guide#section-slug from the article index' },
  related: { type: 'array', items: { type: 'string' } },
  kind: { type: 'string', enum: KINDS },
  module: { type: 'string', enum: MODULES },
  features: { type: 'array', items: { type: 'string' } },
  availability: { type: 'string', enum: Object.keys(AVAILABILITY) },
  enable: {
    type: 'object',
    properties: { how: { type: 'string', enum: Object.keys(ENABLE_HOW) }, path: { type: ['string', 'null'] } },
  },
  where: {
    type: 'object',
    required: ['scope', 'path'],
    properties: { scope: { type: 'string', enum: SCOPES }, path: { type: 'string' } },
  },
  permissions: { type: 'array', items: { type: 'string' } },
  audience: { type: 'array', items: { type: 'string', enum: AUDIENCES } },
  use_case: { type: 'string' },
  internal: {
    type: 'object',
    required: ['when_to_bring_up'],
    properties: {
      cs_action: {
        type: 'object',
        properties: { kind: { type: 'string', enum: Object.keys(CS_ACTION) }, note: { type: ['string', 'null'] } },
      },
      when_to_bring_up: { type: 'string' },
      who_should_get_it: { type: ['string', 'null'] },
      staff_path: { type: ['string', 'null'] },
      gotchas: { type: ['string', 'null'] },
      talk_track: { type: ['string', 'null'] },
    },
  },
};

/**
 * The answer comes back as a forced tool call, so the model never has to hand-escape
 * JSON inside a text block (three of the first fifteen drafts died on a stray quote).
 * The entry's fields sit at the top level of the input next to the decision: when they
 * were nested under one `entry` object the model handed that object over as a JSON
 * string — and mis-escaped it — on about one PR in five. validateEntry is the real gate.
 */
const DECISION_TOOL = {
  name: 'release_decision',
  description:
    'Record whether the pull request is user-visible. decision=skip needs only reason. decision=entry fills the entry fields (id, title, summary, article, kind, where, use_case, internal, …) as structured values — never as a JSON string.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['skip', 'entry'] },
      reason: { type: 'string', description: 'skip only: one sentence' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'entry only' },
      docs_gap: { type: ['string', 'null'], description: 'entry only: what the linked guide should add, or null' },
      why_use_it: { type: 'string', description: 'entry only: 2–4 sentences, the "## Why use it" section of the linked article' },
      ...ENTRY_PROPERTIES,
    },
  },
};
const META_KEYS = new Set(['decision', 'reason', 'confidence', 'docs_gap', 'why_use_it']);

/** Tool input → { decision, reason, confidence, docs_gap, why_use_it, entry }. Tolerates an `entry` blob (object or JSON string). */
function normalizeDecision(input) {
  const out = {
    decision: input.decision,
    reason: input.reason,
    confidence: input.confidence,
    docs_gap: input.docs_gap ?? null,
    why_use_it: input.why_use_it ?? null,
  };
  let entry = {};
  for (const [k, v] of Object.entries(input)) if (!META_KEYS.has(k) && k !== 'entry') entry[k] = v;
  if (input.entry != null) {
    let blob = input.entry;
    if (typeof blob === 'string') blob = JSON.parse(blob); // throws → caller retries once
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) entry = { ...entry, ...blob };
  }
  // "decision": "fixed" — the model put the kind where the decision goes (2 of 80 PRs).
  if (KINDS.includes(out.decision)) {
    entry.kind = entry.kind || out.decision;
    out.decision = 'entry';
  }
  if (out.decision === 'entry') {
    if (!entry.title && !entry.summary) throw new Error('decision=entry but no entry fields (title, summary, …) were given'); // → retry
    out.entry = entry;
  }
  return out;
}

async function callAnthropic(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, tools: [DECISION_TOOL], tool_choice: { type: 'tool', name: DECISION_TOOL.name }, ...body }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function decisionFrom(data) {
  const call = (data.content || []).find((c) => c.type === 'tool_use' && c.name === DECISION_TOOL.name);
  if (call && call.input && typeof call.input === 'object') return { call, input: call.input };
  // A stub or an older model may still answer in text; take the first JSON object in it.
  const text = (data.content || []).map((c) => c.text || '').join('');
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = json.indexOf('{');
  if (start < 0) throw new Error(`model returned no decision (stop_reason ${data.stop_reason})`);
  return { call: null, input: JSON.parse(json.slice(start)) };
}

/**
 * `validate(answer)` returns the validateEntry problems for an entry answer. When
 * there are any, the model gets one more turn with them as the tool result: a
 * draft that fails release:check turns the drafts PR red for everyone.
 */
async function askModel(system, user, validate = () => []) {
  const messages = [{ role: 'user', content: user }];
  const first = await callAnthropic({ system, messages });
  const { call, input } = decisionFrom(first);
  try {
    const answer = normalizeDecision(input);
    const problems = answer.decision === 'entry' ? validate(answer) : [];
    if (!problems.length || !call) return answer;
    messages.push({ role: 'assistant', content: first.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `The entry fails validation:\n- ${problems.join('\n- ')}\nCall release_decision again with the same entry, every problem fixed.`,
        },
      ],
    });
    try {
      const fixed = normalizeDecision(decisionFrom(await callAnthropic({ system, messages })).input);
      return fixed.decision === 'entry' && validate(fixed).length >= problems.length ? answer : fixed;
    } catch {
      return answer;
    }
  } catch (err) {
    if (!call) throw err;
    // One retry, telling the model exactly what it did: the tool result carries the error.
    messages.push({ role: 'assistant', content: first.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Rejected: ${err.message}. Call release_decision again with every entry field as a structured value at the top level of the input (title, summary, where: {scope, path}, internal: {…}). Do not pass a JSON string.`,
        },
      ],
    });
    const second = await callAnthropic({ system, messages });
    return normalizeDecision(decisionFrom(second).input);
  }
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

/**
 * validateEntry requires enable.path unless the change is on by default, and the
 * model leaves it empty about one draft in ten when CS turns the feature on. Fill
 * it from enable.how + where.path, in the wording published entries use, and mark
 * it so the reviewer knows to check it. Returns true when it filled one.
 */
function fillEnablePath(e) {
  if (!e.enable || e.enable.path || !e.enable.how || e.enable.how === 'default_on') return false;
  const feature = (e.features || []).map((slug) => featureFacts(slug, contract)).find((f) => f?.name)?.name || e.title || 'this feature';
  const where = e.where?.path ? `; then ${e.where.path}` : '';
  if (e.enable.how === 'self_serve') e.enable.path = `Get started → Early Access → Preview → ${feature}`;
  else if (e.enable.how === 'support' || e.enable.how === 'csm') e.enable.path = `Ask your Customer Success Manager to enable ${feature}${where}`;
  else if (e.where?.path) e.enable.path = e.where.path;
  else return false;
  if (e.internal?.draft) e.internal.draft.enable_path_derived = true;
  return true;
}

/** check-internal fails the build on any email address in release data. Swap them for a role. */
const EMAIL = /`?([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`?/g;
function scrubEmails(value) {
  if (typeof value === 'string') {
    return value.replace(EMAIL, (_, local) => (/^(support|help|success|cs)$/i.test(local) ? 'Sessionboard Support' : 'the contact on file'));
  }
  if (Array.isArray(value)) return value.map(scrubEmails);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubEmails(v)]));
  return value;
}

function cleanEntry(raw, p, meta) {
  const e = scrubEmails({ ...raw });
  e.shipped = { prs: [p.ref], docs_only: false, live: { us: null, eu: null, me: null } };
  if (e.enable && e.enable.path == null && e.enable.how === 'default_on') delete e.enable.path;
  if (e.availability && !AVAILABILITY[e.availability]) delete e.availability;
  // Permissions are contract slugs (event.contacts.read …). The model tends to write
  // prose here; keep the prose for the reviewer instead of shipping a validation problem.
  const known = new Set(contract.permissions || []);
  const dropped = (Array.isArray(e.permissions) ? e.permissions : []).filter((x) => !known.has(x));
  e.permissions = (Array.isArray(e.permissions) ? e.permissions : []).filter((x) => known.has(x));
  const draft = {
    by: 'release-intake',
    model: MODEL,
    confidence: meta.confidence || null,
    docs_gap: meta.docs_gap || null,
    why_use_it: meta.why_use_it || null,
    at: new Date().toISOString(),
  };
  if (dropped.length) draft.permissions_to_confirm = dropped;
  e.internal = { ...(e.internal || {}), draft };
  fillEnablePath(e);
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
    for (const raw of entries) {
      if (have.has(raw.id)) continue;
      const e = scrubEmails(raw);
      fillEnablePath(e);
      data.entries.push(e);
      have.add(e.id);
      added++;
    }
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  const sections = [];
  for (const entries of byDate.values()) {
    for (const e of entries) {
      const file = addWhyUseIt(scrubEmails(e));
      if (file) sections.push(file);
    }
  }
  return { added, sections };
}

/**
 * check-style requires every article a post-cutover entry links to to carry a
 * "## Why use it" section. Write the draft's long form (or the use_case) into the
 * article above its first H2, so the drafts PR passes CI and the reviewer edits
 * the copy in place. Returns the article path when it wrote one.
 */
function addWhyUseIt(entry) {
  const slug = String(entry.article || '').replace(/#.*$/, '').replace(/^\//, '');
  const clean = (s) =>
    String(s || '')
      .split(SENTENCE_SPLIT)
      .filter((x) => x.trim() && !sentenceClaims(x).length)
      .join(' ')
      .trim();
  const text = clean(entry.internal?.draft?.why_use_it) || clean(entry.use_case);
  if (!slug || !text) return null;
  const file = [join(DOCS_DIR, `${slug}.mdx`), join(DOCS_DIR, slug, 'index.mdx')].find(existsSync);
  if (!file) return null;
  const src = readFileSync(file, 'utf8');
  const fm = /^---\n[\s\S]*?\n---\n/.exec(src);
  if (!fm || /^## Why use it\s*$/m.test(src)) return null;
  const lines = src.slice(fm[0].length).split('\n');
  let fenced = false;
  let at = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    if (!fenced && /^##\s/.test(lines[i])) {
      at = i;
      break;
    }
  }
  const block = ['## Why use it', '', text, ''];
  if (at > 0 && lines[at - 1].trim() !== '') block.unshift('');
  lines.splice(at, 0, ...block);
  writeFileSync(file, fm[0] + lines.join('\n'));
  return relative(process.cwd(), file);
}

if (COLLECT) {
  console.log(JSON.stringify(collectDrafts(COLLECT), null, 2));
  process.exit(0);
}
if (APPLY.length) {
  const lists = APPLY.filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const { added, sections } = applyDrafts(lists);
  console.log(`Applied ${added} draft(s) from ${APPLY.length} file(s); added "Why use it" to ${sections.length} article(s).`);
  for (const f of sections) console.log(`  + ${f}`);
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
    const validate = (a) => {
      if (!a.entry || typeof a.entry !== 'object') return [];
      const e = cleanEntry(a.entry, p, a);
      e.id = e.id || `${p.repo}-${p.number}`;
      return validateEntry(e, TODAY, contract, { file: `src/data/release-notes/${TODAY}.json` }).map((x) => x.replace(/^.*?\]\s*/, ''));
    };
    answer = await askModel(SYSTEM, userPrompt({ pr, files, p, articles, features, example }), validate);
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
for (const problem of result.problems) console.log(`  ⚠ ${problem}`);
console.log(`\n${result.drafted.length} drafted, ${result.skipped.length} skipped, ${result.problems.length} problem(s).${DRY ? ' (dry run — nothing written)' : ''}`);
