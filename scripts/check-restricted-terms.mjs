#!/usr/bin/env node
/**
 * The Help Center and API docs are public and crawled (2026-11-14). Josh's rule
 * for that: nothing public about registration, lead scanning, check-in, badges,
 * Expo or anything else Cvent would find competitive. Pages about those subjects
 * are restricted (site.json `staffOnly` = staff, `signedInOnly` = any signed-in
 * user; src/lib/staff-only.mjs).
 *
 * This fails when a page that is NOT restricted mentions one of those subjects,
 * and when the public OpenAPI spec (public/api/openapi.json) holds a restricted
 * operation. Fix it by moving the passage to a restricted page, or by adding the
 * page to site.json `signedInOnly`. Never loosen a pattern to make a page pass
 * without Josh's OK.
 *
 * Generic words stay allowed: "register for a webinar", "registrations" on a
 * Marketing turnout goal, "attendees", "exhibitors" and "sponsors" are shipped
 * Platform and Marketing features. The patterns target Sessionboard's own
 * registration, onsite and Expo products.
 *
 *   node scripts/check-restricted-terms.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStaffOnlySlug } from '../src/lib/staff-only.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

export const PATTERNS = [
  [/lead[- ]?scan/i, 'lead scanning'],
  [/lead retrieval/i, 'lead retrieval'],
  [/scan(ning)? (attendee |exhibitor )?leads/i, 'lead scanning'],
  [/badge[- ]print|print(ing)? (name )?badges|badge-print-jobs/i, 'badge printing'],
  [/ticket[- ]types?\b/i, 'ticket types'],
  [/sell(ing)? tickets/i, 'ticket sales'],
  [/\b(read|write):(registrations|expo)\b/, 'Registration / Expo API scopes'],
  [/\b(read_registration_|find_registrations\b)/, 'Registration MCP tools'],
  [/\/v1\/event\/\{eventId\}\/(registrations?|ticket-types|check-ins|badge-print-jobs|booths|orders|sponsorships)\b/, 'Registration / Expo endpoints'],
  [/\]\(\/(registration|expo|onsite|attend)(\/|\)|#)|href=["']\/(registration|expo|onsite|attend)(\/|["'#])/, 'link into a staff-only section'],
  [/booth sales|sell(ing)? booths|floor[- ]plan|floor map/i, 'Expo booth sales'],
  [/onsite check-?in|check-?in (desk|kiosk|station)|(check-?in|registration|badge) kiosk|kiosk (check-?in|lookup)/i, 'onsite check-in'],
  [/Sessionboard Registration\b|Sessionboard registration\b|Registration (module|product)\b/, 'the Registration product'],
  [/Attend (mobile )?app\b/, 'the Attend app'],
];

/**
 * Lines that name a subject only as a third-party product's feature (an integration we sync
 * with), not ours. `file` relative to the repo, `includes` a fragment of the line. Add one
 * only with the reason, and never for Sessionboard's own Registration, Onsite or Expo.
 */
export const ALLOWED = [
  { file: 'src/content/docs/apps/map-your-show-integration.mdx', includes: 'Map Your Show (MYS) runs the exhibitor sales, floor plans', why: 'Map Your Show feature' },
  { file: 'src/content/docs/apps/swapcard-integration.mdx', includes: 'used to print badges', why: 'Swapcard feature' },
  { file: 'src/content/docs/marketing/advocacy-activate-from-your-systems.mdx', includes: 'An exhibitor or floor-plan system (Map Your Show', why: 'third-party exhibitor systems Advocacy reads from' },
];
const allowed = (file, line) => ALLOWED.some((a) => a.file === file && line.includes(a.includes));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Route slug of a content file: src/content/docs/a/b.mdx → a/b; src/api-docs/<product>/x.mdx → <product base>/x. */
function slugOf(file) {
  const rel = relative(join(ROOT, 'src/content/docs'), file);
  if (!rel.startsWith('..')) return rel.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
  return null;
}

export function findProblems() {
  const problems = [];
  const files = walk(join(ROOT, 'src/content/docs'));
  for (const file of files) {
    const slug = slugOf(file);
    if (slug === null || isStaffOnlySlug(slug, site)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const rel = relative(ROOT, file);
    lines.forEach((line, i) => {
      if (allowed(rel, line)) return;
      for (const [re, what] of PATTERNS) {
        if (re.test(line)) problems.push(`${rel}:${i + 1} mentions ${what}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  // Self-serve product API guides (src/api-docs/<product>/) are public too.
  const apiDocs = join(ROOT, 'src/api-docs');
  if (existsSync(apiDocs)) {
    for (const file of walk(apiDocs)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const [re, what] of PATTERNS) if (re.test(line)) problems.push(`${relative(ROOT, file)}:${i + 1} mentions ${what}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  const specFile = join(ROOT, 'public/api/openapi.json');
  if (existsSync(specFile)) {
    const tags = new Set(site.signedInOnly?.apiTags ?? []);
    const spec = JSON.parse(readFileSync(specFile, 'utf8'));
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(item)) {
        if (op && Array.isArray(op.tags) && op.tags.some((t) => tags.has(t))) problems.push(`public/api/openapi.json: ${method.toUpperCase()} ${path} is a signed-in-only operation`);
      }
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = findProblems();
  if (problems.length) {
    console.error(`Restricted subjects on public pages (${problems.length}). Move the passage to a restricted page or add the page to site.json signedInOnly — and ask Josh before opening any of it:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('No restricted subjects on public pages.');
}
