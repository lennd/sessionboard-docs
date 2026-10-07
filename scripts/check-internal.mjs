#!/usr/bin/env node
/**
 * The staff-only enablement section (src/pages/<internalPrefix>/) is open but
 * unlisted. This is the check that keeps "unlisted" true, and that nothing in
 * it, or in the release data that feeds it, would hurt us if someone found it.
 *
 * Fails when:
 *   - site.json `internalPrefix` does not match a directory under src/pages/
 *   - any PUBLIC built page links to the section (sidebar, articles, footer…)
 *   - the sitemap, llms*.txt or help-index.json mention the section
 *   - a built page under the section lacks the noindex meta
 *   - release data or the section's source contains something that looks like
 *     a secret (webhook URL, token, key, JWT, connection string) or an email
 *     address (a customer identifier has no business in release notes)
 *
 * Run after `npm run build`:  node scripts/check-internal.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const PREFIX = String(site.internalPrefix || '').replace(/^\/|\/$/g, '');
const DIST = join(ROOT, 'dist');

const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. Prefix is configured and the pages exist.
if (!PREFIX) fail('site.json has no internalPrefix');
const pagesDir = join(ROOT, 'src', 'pages', PREFIX);
if (PREFIX && !existsSync(pagesDir)) fail(`site.json internalPrefix "${PREFIX}" has no src/pages/${PREFIX}/ directory`);

// 2. No public page links to the section.
if (!existsSync(DIST)) {
  fail('dist/ does not exist — run `npm run build` first');
} else {
  const linkRe = new RegExp(`(?:href|src|content)=["'](?:https?://[^/"']+)?/${PREFIX}(?:/|["'#?])`, 'i');
  const prefixDir = join(DIST, PREFIX);
  const html = walk(DIST).filter((p) => p.endsWith('.html'));
  for (const file of html) {
    const inside = file === `${prefixDir}.html` || file.startsWith(`${prefixDir}/`);
    const body = readFileSync(file, 'utf8');
    if (!inside) {
      if (linkRe.test(body)) fail(`public page links to the internal section: ${relative(ROOT, file)}`);
    } else {
      if (!/<meta\s+name="robots"\s+content="noindex[^"]*"/i.test(body)) fail(`internal page lacks noindex meta: ${relative(ROOT, file)}`);
      if (/data-pagefind-body/.test(body)) fail(`internal page is indexed by site search: ${relative(ROOT, file)}`);
    }
  }
  if (!existsSync(prefixDir) && !existsSync(`${prefixDir}.html`)) fail(`dist/${PREFIX}/ was not built`);

  // 3. Machine surfaces.
  for (const name of readdirSync(DIST)) {
    if (/^sitemap.*\.xml$/.test(name) && readFileSync(join(DIST, name), 'utf8').includes(`/${PREFIX}`)) fail(`${name} lists the internal section`);
    if (/^llms.*\.txt$/.test(name) && readFileSync(join(DIST, name), 'utf8').includes(`/${PREFIX}/`)) fail(`${name} mentions the internal section`);
  }
  const helpIndex = join(DIST, '_internal', 'help-index.json');
  if (existsSync(helpIndex) && readFileSync(helpIndex, 'utf8').includes(`"/${PREFIX}`)) fail('help-index.json includes internal pages');
}

// 4. Nothing secret-looking in the data or the section's source.
const SECRET_PATTERNS = [
  [/hooks\.slack\.com\/services\//i, 'Slack webhook URL'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/\bpat-[a-z0-9-]{2,}-[0-9a-f-]{30,}/i, 'HubSpot private app token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"']+/i, 'database connection string'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'bearer token'],
  [/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i, 'credential assignment'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address'],
];
const sources = [
  ...walk(join(ROOT, 'src', 'data', 'release-notes')),
  ...walk(pagesDir),
  ...walk(join(ROOT, 'src', 'components', 'enablement')),
];
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) fail(`${relative(ROOT, file)} contains what looks like a ${label}: ${m[0].slice(0, 12)}…`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n${problems.length} problem(s). The enablement section must stay unlisted and secret-free.`);
  process.exit(1);
}
console.log(`✓ /${PREFIX}/ is unlisted (no public links, not in sitemap/llms/help-index, noindex on every page) and secret-free`);
