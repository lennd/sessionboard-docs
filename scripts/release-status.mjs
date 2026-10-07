#!/usr/bin/env node
/**
 * Flip release entries from staged to live by asking production, not main.
 *
 * Docs deploy the moment they merge; the product does not. web-api and
 * web-ui-v2 ship to prod-us and prod-eu as manual workflow_dispatch runs from
 * release/YYYY-MM-DD branches, so an article can be live for a week before the
 * feature is. CS reading "shipped" and going to look for it in a customer's
 * org is the failure this script exists to prevent.
 *
 * For every entry with a region still `null` in `shipped.live`:
 *   1. find the latest SUCCESSFUL run of that repo's production workflow for the
 *      region (src/data/release-notes/_config.json) and take its head commit;
 *   2. for every PR the entry names, take its merge commit and ask the compare
 *      API whether it is an ancestor of that head (status `ahead` or
 *      `identical`);
 *   3. when every PR is in, write today's date into `shipped.live.<region>`.
 *
 * `docs_only` entries go live on the day they are checked. Dates are never
 * removed: production does not un-ship.
 *
 * Auth: GH_RELEASE_STATUS_TOKEN or GITHUB_TOKEN with `actions:read` and
 * `pull_requests:read` on the product repos. Locally, `gh auth token` is used
 * when neither is set.
 *
 *   node scripts/release-status.mjs            # write
 *   node scripts/release-status.mjs --dry-run  # report only
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR, allEntries, loadReleaseNotes } from '../src/lib/release-notes.mjs';

const DRY = process.argv.includes('--dry-run');
const CONFIG = JSON.parse(readFileSync(join(DATA_DIR, '_config.json'), 'utf8'));
const API = 'https://api.github.com';

function token() {
  if (process.env.GH_RELEASE_STATUS_TOKEN) return process.env.GH_RELEASE_STATUS_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const TOKEN = token();
if (!TOKEN) {
  console.error('\n✖ No GitHub token. Set GH_RELEASE_STATUS_TOKEN (or run `gh auth login`).\n');
  process.exit(1);
}

async function gh(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sessionboard-docs release-status',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** `lennd/sessionboard-web-api#4120` or `web-api#4120` → { owner, repo, number }. */
function parsePr(ref) {
  const m = /^(?:([a-z0-9-]+)\/)?([a-z0-9-]+)#(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad PR ref ${ref}`);
  const repo = CONFIG.aliases[m[2]] || m[2];
  const conf = CONFIG.repos[repo];
  if (!conf) throw new Error(`${ref}: repo ${repo} is not in _config.json`);
  return { owner: m[1] || conf.owner, repo, number: Number(m[3]), workflows: conf.workflows };
}

const headCache = new Map();
/** Head commit of the latest successful production run for (repo, region), or null when never run. */
async function prodHead(owner, repo, workflow) {
  const key = `${owner}/${repo}/${workflow}`;
  if (headCache.has(key)) return headCache.get(key);
  let head = null;
  try {
    const data = await gh(`/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?status=success&per_page=1`);
    head = data.workflow_runs?.[0]
      ? { sha: data.workflow_runs[0].head_sha, at: data.workflow_runs[0].created_at, branch: data.workflow_runs[0].head_branch }
      : null;
  } catch (err) {
    if (!/404/.test(err.message)) throw err;
  }
  headCache.set(key, head);
  return head;
}

const mergeCache = new Map();
async function mergeSha(owner, repo, number) {
  const key = `${owner}/${repo}#${number}`;
  if (mergeCache.has(key)) return mergeCache.get(key);
  const pr = await gh(`/repos/${owner}/${repo}/pulls/${number}`);
  const sha = pr.merged_at ? pr.merge_commit_sha : null;
  mergeCache.set(key, sha);
  return sha;
}

async function isAncestor(owner, repo, base, head) {
  const cmp = await gh(`/repos/${owner}/${repo}/compare/${base}...${head}`);
  return cmp.status === 'ahead' || cmp.status === 'identical';
}

const today = new Date().toISOString().slice(0, 10);
const { releases, problems } = loadReleaseNotes();
if (problems.length) {
  console.error(`\n✖ release notes invalid:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const changes = [];
for (const entry of allEntries(releases)) {
  const live = entry.shipped.live;
  const pending = ['us', 'eu', 'me'].filter((r) => !live[r]);
  if (pending.length === 0) continue;

  if (entry.shipped.docs_only || entry.shipped.prs.length === 0) {
    // Nothing to deploy, or a pre-cutover entry migrated without PR refs.
    if (entry.shipped.docs_only) {
      for (const r of pending) live[r] = today;
      changes.push({ entry, regions: pending, reason: 'docs only' });
    } else if (entry.shipped.pending) {
      // Documented before the PR existed. Loud, because it stays staged until someone adds the PR numbers.
      console.log(`  ⏳ ${entry.id}: no PR yet (${entry.shipped.pending}) — add shipped.prs once it is open`);
    }
    continue;
  }

  const prs = entry.shipped.prs.map(parsePr);
  for (const region of pending) {
    let allIn = true;
    const detail = [];
    for (const pr of prs) {
      const workflow = pr.workflows[region];
      if (!workflow) {
        // The repo has no deploy for this region (public-api has no ME, say): not a blocker.
        detail.push(`${pr.repo}#${pr.number}: no ${region} deploy`);
        continue;
      }
      const merge = await mergeSha(pr.owner, pr.repo, pr.number);
      if (!merge) {
        allIn = false;
        detail.push(`${pr.repo}#${pr.number}: not merged`);
        continue;
      }
      const head = await prodHead(pr.owner, pr.repo, workflow);
      if (!head) {
        allIn = false;
        detail.push(`${pr.repo}#${pr.number}: no successful ${region} run`);
        continue;
      }
      const deployed = await isAncestor(pr.owner, pr.repo, merge, head.sha);
      detail.push(`${pr.repo}#${pr.number}: ${deployed ? 'in' : 'NOT in'} ${region} (${head.branch} @ ${head.sha.slice(0, 7)})`);
      if (!deployed) allIn = false;
    }
    if (allIn) {
      live[region] = today;
      changes.push({ entry, regions: [region], reason: detail.join('; ') });
    } else {
      console.log(`  staged  ${entry.id} [${region}] — ${detail.join('; ')}`);
    }
  }
}

if (changes.length === 0) {
  console.log('✓ No status changes.');
  process.exit(0);
}

for (const c of changes) console.log(`  live    ${c.entry.id} [${c.regions.join(', ')}] — ${c.reason}`);

if (DRY) {
  console.log(`\n(dry run) ${changes.length} change(s) not written.`);
  process.exit(0);
}

// Write back only the files that changed, preserving each file's formatting.
const touched = new Set(changes.map((c) => c.entry.date));
for (const date of touched) {
  const file = join(DATA_DIR, `${date}.json`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const resolved = new Map(releases.find((r) => r.date === date).entries.map((e) => [e.id, e]));
  for (const raw of data.entries) {
    const r = resolved.get(raw.id);
    raw.shipped = { ...(raw.shipped || {}), live: { ...r.shipped.live } };
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`\n✓ Updated ${touched.size} release file(s).`);
