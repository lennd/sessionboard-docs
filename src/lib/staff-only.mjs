/**
 * Staff-only sections of the Help Center — which pages they are.
 *
 * Pages for products that are not public yet (Registration, Expo, Onsite) are
 * built and deployed with everything else, but only a signed-in Sessionboard
 * staff member (a super user in the product) can see them. The rule lives in
 * site.json `staffOnly` and is read by every surface that could leak a page:
 *
 *   worker.js            404s the page and its share card for everyone else, and
 *                        strips its sidebar group and every link to it from the
 *                        HTML the public gets (src/lib/account-session.mjs
 *                        signs staff in);
 *   src/route-data.ts    keeps it out of the Pagefind search index;
 *   astro.config.mjs     keeps it out of sitemap.xml and the llms*.txt exports;
 *   Head.astro           noindex, no share card, no analytics;
 *   SidebarSublist.astro tags its sidebar group so the Worker can find it;
 *   build-help-index     keeps it out of the corpus Team Lead answers from.
 *
 * Unreleased product suites (src/data/suites.json `released: false`, e.g.
 * /sessionboard-marketing) are staff-only sections too, with their screenshots
 * (/images/suites/<key>/), so staff can read and switch to them before the
 * product ships (src/lib/suites.mjs). A local preview build that names a suite
 * in SB_PREVIEW_SUITES treats it as public.
 *
 * Slugs here are route slugs without a leading slash (`registration/overview`).
 */
import suitesConfig from '../data/suites.json' with { type: 'json' };

const trimSlashes = (value) => String(value ?? '').replace(/^\/+|\/+$/g, '');

/**
 * SB_PREVIEW_SUITES for this process: the build's environment, or — in the Worker,
 * which has no process.env — what worker.js copies from its own env (setPreviewSuites).
 * Production sets neither, so every unreleased suite stays staff-only (fail closed).
 */
let workerPreviewSuites = '';
export function setPreviewSuites(value) {
  workerPreviewSuites = String(value ?? '');
}

/** Unreleased suites (not named by SB_PREVIEW_SUITES): `[{ key, prefix }]`. */
function staffOnlySuitePrefixes() {
  const preview = String(globalThis.process?.env?.SB_PREVIEW_SUITES ?? workerPreviewSuites).trim().toLowerCase();
  const all = ['1', 'all', 'true', 'yes'].includes(preview);
  const named = new Set(preview.split(',').map((s) => s.trim()).filter(Boolean));
  return Object.entries(suitesConfig.suites)
    .filter(([key, s]) => s.path && !s.released && !all && !named.has(key))
    .map(([key, s]) => ({ key, prefix: trimSlashes(s.path) }));
}

const normalizeRule = (config = {}) => ({
  prefixes: (config.prefixes ?? []).map(trimSlashes).filter(Boolean),
  pages: (config.pages ?? []).map(trimSlashes).filter(Boolean),
});

/**
 * Two tiers share this plumbing (Josh, 2026-11-14):
 *   - staff:    site.json `staffOnly` plus unreleased suites — super users only;
 *   - signedIn: site.json `signedInOnly` — any signed-in Sessionboard user
 *               (registration, check-in, badges, lead scanning, Expo: whatever
 *               Cvent would find competitive). Never public.
 * The plain names below (staffOnlyRule, isStaffOnlySlug, isStaffOnlyPath,
 * isStaffOnlyHref, staffOnlyGlobs) mean "restricted": either tier. Every
 * build-time surface that keeps a page from the public (search, sitemap,
 * llms.txt, noindex, sidebar markers, Team Lead) uses them and so fails
 * closed. Only worker.js tells the tiers apart (staffTierPath / signedInOnlyPath).
 */
function tierRule(site, tier) {
  const staff = normalizeRule(site?.staffOnly);
  const signedIn = normalizeRule(site?.signedInOnly);
  const suites = staffOnlySuitePrefixes().map((s) => s.prefix);
  const parts = tier === 'staff' ? [staff] : tier === 'signedIn' ? [signedIn] : [staff, signedIn];
  return {
    prefixes: [...parts.flatMap((r) => r.prefixes), ...(tier === 'signedIn' ? [] : suites)],
    pages: new Set(parts.flatMap((r) => r.pages)),
  };
}

/** The configured rule (both tiers), normalized: `{ prefixes: string[], pages: Set<string> }`. */
export function staffOnlyRule(site) {
  return tierRule(site, 'all');
}

function slugMatches(slug, rule) {
  const clean = trimSlashes(slug).replace(/\.html$/, '');
  if (!clean) return false;
  return rule.pages.has(clean) || rule.prefixes.some((p) => clean === p || clean.startsWith(`${p}/`));
}

/** Is the page at this route slug (`registration/overview`, `/onsite`) restricted (either tier)? */
export function isStaffOnlySlug(slug, site) {
  return slugMatches(slug, tierRule(site, 'all'));
}

/** Is the page at this route slug in the signed-in tier only (not staff)? */
export function isSignedInOnlySlug(slug, site) {
  return !slugMatches(slug, tierRule(site, 'staff')) && slugMatches(slug, tierRule(site, 'signedIn'));
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Path → the tier test it needs: a share card tests its page; an unreleased suite's screenshots are staff. */
function pathMatches(pathname, site, tier) {
  const path = decodePath(pathname);
  const og = path.match(/^\/og\/(.+)\.png$/);
  const rule = tierRule(site, tier);
  if (og) return slugMatches(og[1].replace(/--/g, '/'), rule);
  const shot = path.match(/^\/images\/suites\/([^/]+)\//);
  if (shot) return tier !== 'signedIn' && staffOnlySuitePrefixes().some((s) => s.key === shot[1]);
  return slugMatches(path, rule);
}

/**
 * Is this request path restricted (either tier)? Covers the page itself (with or without
 * `.html` or a trailing slash) and its share card (`/og/<slug with -- for />.png`).
 */
export function isStaffOnlyPath(pathname, site) {
  return pathMatches(pathname, site, 'all');
}

/** Is this request path in the staff tier (super users only)? */
export function isStaffTierPath(pathname, site) {
  return pathMatches(pathname, site, 'staff');
}

/** Is this request path signed-in only (any signed-in user, not public, not staff-only)? */
export function isSignedInOnlyPath(pathname, site) {
  return !pathMatches(pathname, site, 'staff') && pathMatches(pathname, site, 'signedIn');
}

/**
 * Does this href (as written in the built HTML) point at a staff-only page?
 * Root-relative and same-site absolute links count; anchors, other hosts and
 * `app:` markers do not.
 */
export function isStaffOnlyHref(href, site, tier = 'all') {
  if (!href) return false;
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    const hosts = new Set([site?.canonicalHost, ...(site?.legacyHosts ?? [])]);
    if (!hosts.has(url.hostname)) return false;
    path = url.pathname;
  } else if (!href.startsWith('/')) {
    return false;
  }
  return pathMatches(path.split(/[?#]/)[0], site, tier);
}

/** Glob patterns (micromatch, against content ids) for the starlight-llms-txt `exclude` option. */
export function staffOnlyGlobs(site) {
  const { prefixes, pages } = staffOnlyRule(site);
  return [...prefixes.flatMap((p) => [p, `${p}/**`]), ...pages];
}

/** OpenAPI tags whose operations are signed-in only (site.json `signedInOnly.apiTags`): kept out of the public spec and llms.txt. */
export function signedInOnlyApiTags(site) {
  return new Set(site?.signedInOnly?.apiTags ?? []);
}
