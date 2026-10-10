/**
 * The GitHub REST client the release scripts share.
 *
 * Token order: GH_RELEASE_STATUS_TOKEN (the fine-grained PAT the daily job
 * carries — Actions: read + Pull requests: read on the product repos,
 * Contents: write here), then GITHUB_TOKEN, then `gh auth token` for a
 * developer shell. `scripts/release-status.mjs` predates this file and keeps
 * its own copy of the same logic on purpose — it is the one script that runs
 * on every schedule and nobody wants a refactor to be what breaks it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR } from './release-notes.mjs';

const API = 'https://api.github.com';

export function githubToken() {
  if (process.env.GH_RELEASE_STATUS_TOKEN) return process.env.GH_RELEASE_STATUS_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function requireToken() {
  const t = githubToken();
  if (!t) {
    console.error('\n✖ No GitHub token. Set GH_RELEASE_STATUS_TOKEN (or run `gh auth login`).\n');
    process.exit(1);
  }
  return t;
}

/** GET (or `method`) a GitHub API path; `body` is JSON-encoded. Throws on non-2xx. */
export async function gh(path, { token = requireToken(), method = 'GET', body = undefined, userAgent = 'sessionboard-docs release-scripts' } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': userAgent,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${method} ${path}: ${(await res.text()).slice(0, 300)}`);
  if (res.status === 204) return null;
  return res.json();
}

export function releaseConfig() {
  return JSON.parse(readFileSync(join(DATA_DIR, '_config.json'), 'utf8'));
}

/**
 * `lennd/sessionboard-web-api#4120`, `web-api#4120` or `sessionboard-web-api#4120`
 * → { owner, repo, number, ref } with `ref` in the canonical `lennd/<repo>#<n>` form.
 */
export function parsePrRef(ref, config = releaseConfig()) {
  const m = /^(?:([a-z0-9-]+)\/)?([a-z0-9-]+)#(\d+)$/i.exec(String(ref).trim());
  if (!m) return null;
  const repo = config.aliases[m[2]] || m[2];
  const conf = config.repos[repo];
  if (!conf) return null;
  const owner = m[1] || conf.owner;
  return { owner, repo, number: Number(m[3]), ref: `${owner}/${repo}#${m[3]}`, workflows: conf.workflows };
}
