#!/usr/bin/env node
/**
 * Which merged PRs have no release entry yet?
 *
 * Every product change a user can see is supposed to land in
 * src/data/release-notes/ in the same round as its docs. This is the check
 * that finds the ones that did not: it lists PRs merged into `main` in each
 * product repo (src/data/release-notes/_config.json) over the last N days
 * and subtracts every PR some entry already names in `shipped.prs`.
 *
 * The ledger is src/data/release-notes/_intake.json — one record per PR the
 * pipeline has seen, with a decision:
 *
 *   pending  — merged, not covered, not yet triaged: this is a gap
 *   drafted  — scripts/release-intake.mjs opened a review PR with a draft entry
 *   entry    — an entry names it (filled in automatically; never a gap)
 *   skip     — a person or the heuristics below decided it is not user-visible
 *              (`reason` says why; a human `skip` is never overturned)
 *
 * Heuristics that mark a PR `skip` on first sight: dependabot, titles that
 * start with chore/ci/test/build/deps/refactor/revert, and the labels
 * `no-release-note` / `release-note:none`. Everything else is `pending` until
 * an entry names it or someone writes `skip` into the ledger.
 *
 *   node scripts/release-gaps.mjs                 # table of pending PRs (14 days, never before _intake.json "since")
 *   node scripts/release-gaps.mjs --days 30       # wider window (still bounded by "since")
 *   node scripts/release-gaps.mjs --write         # also update _intake.json
 *   node scripts/release-gaps.mjs --json          # machine-readable
 *   node scripts/release-gaps.mjs --summary FILE  # append a Markdown table (GITHUB_STEP_SUMMARY)
 *
 * Exit code is 0 whether or not there are gaps — this is a worklist, not a
 * gate. `--strict` exits 1 when anything is pending, for a local pre-finalize
 * check.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CUTOVER, DATA_DIR, allEntries, loadReleaseNotes } from '../src/lib/release-notes.mjs';
import { gh, parsePrRef, releaseConfig, requireToken } from '../src/lib/github-api.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DAYS = Number(value('--days', 14));
const WRITE = flag('--write');
const JSON_OUT = flag('--json');
const STRICT = flag('--strict');
const SUMMARY = value('--summary', process.env.GITHUB_STEP_SUMMARY_APPEND ? process.env.GITHUB_STEP_SUMMARY : null);

export const INTAKE_FILE = join(DATA_DIR, '_intake.json');

const SKIP_TITLE = /^\s*(?:\[[^\]]*\]\s*)?(chore|ci|test|tests|build|deps|dependabot|refactor|revert|docs)\b/i;
const SKIP_LABELS = new Set(['no-release-note', 'release-note:none', 'skip-release-note']);

export function loadIntake() {
  if (!existsSync(INTAKE_FILE)) {
    return {
      '//': 'Ledger of merged product PRs and whether the release notes cover them. Written by scripts/release-gaps.mjs and scripts/release-intake.mjs; edit a record to "skip" (with a reason) when a PR is not something a user can see. Decisions: pending | drafted | entry | skip. PRs merged before "since" are not tracked.',
      since: CUTOVER,
      prs: {},
    };
  }
  return JSON.parse(readFileSync(INTAKE_FILE, 'utf8'));
}

export function saveIntake(intake) {
  const ordered = Object.fromEntries(
    Object.entries(intake.prs).sort(([, a], [, b]) => (a.merged_at < b.merged_at ? 1 : -1)),
  );
  writeFileSync(INTAKE_FILE, `${JSON.stringify({ ...intake, prs: ordered }, null, 2)}\n`);
}

/** Every PR named by any entry, as canonical refs → entry id. */
export function coveredPrs(releases = loadReleaseNotes().releases, config = releaseConfig()) {
  const map = new Map();
  for (const e of allEntries(releases)) {
    for (const raw of e.shipped?.prs || []) {
      const p = parsePrRef(raw, config);
      if (p) map.set(p.ref, e.id);
    }
  }
  return map;
}

export function heuristicSkip(pr) {
  const login = pr.user?.login || '';
  if (/dependabot|renovate|github-actions/i.test(login)) return `bot author ${login}`;
  const labels = (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const hit = labels.find((l) => SKIP_LABELS.has(l));
  if (hit) return `label ${hit}`;
  const m = SKIP_TITLE.exec(pr.title || '');
  if (m) return `title prefix "${m[1]}"`;
  return null;
}

/** Merged-to-main PRs in one repo since `since` (ISO date). */
export async function mergedPrs(owner, repo, since, token) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/repos/${owner}/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`, { token });
    if (!list.length) break;
    let older = false;
    for (const pr of list) {
      if (pr.updated_at < since) older = true;
      if (pr.merged_at && pr.merged_at >= since) out.push(pr);
    }
    if (older) break;
  }
  return out;
}

export function recordFor(pr, owner, repo) {
  return {
    title: pr.title,
    url: pr.html_url,
    author: pr.user?.login || null,
    merged_at: pr.merged_at,
    merge_sha: pr.merge_commit_sha || null,
    labels: (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    base: pr.base?.ref || 'main',
    repo: `${owner}/${repo}`,
  };
}

/**
 * Reconcile the ledger with GitHub and the entries. Returns { intake, gaps, changed }.
 * Pure apart from the GitHub reads; the caller decides whether to write.
 */
export async function reconcile({ days = DAYS, token = requireToken(), config = releaseConfig(), releases = loadReleaseNotes().releases } = {}) {
  const intake = loadIntake();
  // Never look back past the ledger's epoch: entries only became mandatory at
  // the cutover, and a 400-PR backlog nobody will triage is noise, not a worklist.
  const epoch = `${intake.since || CUTOVER}T00:00:00Z`;
  const window = new Date(Date.now() - days * 86400e3).toISOString();
  const since = window > epoch ? window : epoch;
  const covered = coveredPrs(releases, config);
  const now = new Date().toISOString().slice(0, 10);
  let changed = false;

  for (const [repo, conf] of Object.entries(config.repos)) {
    const prs = await mergedPrs(conf.owner, repo, since, token);
    for (const pr of prs) {
      const ref = `${conf.owner}/${repo}#${pr.number}`;
      const existing = intake.prs[ref];
      const base = existing || { ...recordFor(pr, conf.owner, repo), decision: 'pending', seen_at: now };
      if (!existing) {
        const why = heuristicSkip(pr);
        if (why) {
          base.decision = 'skip';
          base.reason = why;
          base.decided_by = 'heuristic';
        }
        changed = true;
      }
      intake.prs[ref] = base;
    }
  }

  // Entries win: anything an entry names is covered, whatever the ledger said
  // (a human `skip` on a PR that later got an entry is just stale).
  for (const [ref, entryId] of covered) {
    const rec = intake.prs[ref];
    if (!rec) continue;
    if (rec.decision !== 'entry' || rec.entry_id !== entryId) {
      rec.decision = 'entry';
      rec.entry_id = entryId;
      delete rec.reason;
      delete rec.decided_by;
      changed = true;
    }
  }

  const gaps = Object.entries(intake.prs)
    .filter(([, r]) => r.decision === 'pending')
    .map(([ref, r]) => ({ ref, ...r }))
    .sort((a, b) => (a.merged_at < b.merged_at ? 1 : -1));
  const drafted = Object.entries(intake.prs)
    .filter(([, r]) => r.decision === 'drafted')
    .map(([ref, r]) => ({ ref, ...r }));

  return { intake, gaps, drafted, changed, since };
}

function table(rows) {
  if (!rows.length) return '_No merged PRs are missing a release entry._\n';
  const lines = ['| Merged | PR | Title | Author |', '| --- | --- | --- | --- |'];
  for (const g of rows) lines.push(`| ${g.merged_at.slice(0, 10)} | [${g.ref}](${g.url}) | ${g.title.replace(/\|/g, '\\|')} | ${g.author || ''} |`);
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { intake, gaps, drafted, changed, since } = await reconcile();
  if (WRITE && changed) saveIntake(intake);

  if (JSON_OUT) {
    console.log(JSON.stringify({ since, gaps, drafted }, null, 2));
  } else {
    console.log(`\nMerged PRs since ${since.slice(0, 10)} with no release entry: ${gaps.length}${drafted.length ? ` (+${drafted.length} drafted, awaiting review)` : ''}\n`);
    for (const g of gaps) console.log(`  ${g.merged_at.slice(0, 10)}  ${g.ref.padEnd(36)}  ${g.title}  (${g.author})`);
    for (const d of drafted) console.log(`  drafted   ${d.ref.padEnd(36)}  ${d.title}  → ${d.draft_pr || '?'}`);
    if (gaps.length) console.log('\nWrite an entry (shipped.prs names the PR) or set its _intake.json record to "skip" with a reason.');
    if (WRITE) console.log(changed ? `\nUpdated ${INTAKE_FILE.replace(process.cwd() + '/', '')}` : '\nLedger already current.');
    console.log('');
  }
  if (SUMMARY) appendFileSync(SUMMARY, `\n### Merged PRs without a release entry (since ${since.slice(0, 10)})\n\n${table(gaps)}`);
  if (STRICT && gaps.length) process.exit(1);
}
