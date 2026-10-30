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
 *                        HTML the public gets (src/lib/staff-session.mjs signs
 *                        staff in);
 *   src/route-data.ts    keeps it out of the Pagefind search index;
 *   astro.config.mjs     keeps it out of sitemap.xml and the llms*.txt exports;
 *   Head.astro           noindex, no share card, no analytics;
 *   SidebarSublist.astro tags its sidebar group so the Worker can find it;
 *   build-help-index     keeps it out of the corpus Team Lead answers from.
 *
 * Slugs here are route slugs without a leading slash (`registration/overview`).
 */

const trimSlashes = (value) => String(value ?? '').replace(/^\/+|\/+$/g, '');

/** The configured rule, normalized: `{ prefixes: string[], pages: Set<string> }`. */
export function staffOnlyRule(site) {
  const config = site?.staffOnly ?? {};
  return {
    prefixes: (config.prefixes ?? []).map(trimSlashes).filter(Boolean),
    pages: new Set((config.pages ?? []).map(trimSlashes).filter(Boolean)),
  };
}

/** Is the page at this route slug (`registration/overview`, `/onsite`) staff-only? */
export function isStaffOnlySlug(slug, site) {
  const clean = trimSlashes(slug).replace(/\.html$/, '');
  if (!clean) return false;
  const { prefixes, pages } = staffOnlyRule(site);
  return pages.has(clean) || prefixes.some((p) => clean === p || clean.startsWith(`${p}/`));
}

/**
 * Is this request path staff-only? Covers the page itself (with or without
 * `.html` or a trailing slash) and its share card (`/og/<slug with -- for />.png`).
 */
export function isStaffOnlyPath(pathname, site) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    path = pathname;
  }
  const og = path.match(/^\/og\/(.+)\.png$/);
  if (og) return isStaffOnlySlug(og[1].replace(/--/g, '/'), site);
  return isStaffOnlySlug(path, site);
}

/**
 * Does this href (as written in the built HTML) point at a staff-only page?
 * Root-relative and same-site absolute links count; anchors, other hosts and
 * `app:` markers do not.
 */
export function isStaffOnlyHref(href, site) {
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
  return isStaffOnlyPath(path.split(/[?#]/)[0], site);
}

/** Glob patterns (micromatch, against content ids) for the starlight-llms-txt `exclude` option. */
export function staffOnlyGlobs(site) {
  const { prefixes, pages } = staffOnlyRule(site);
  return [...prefixes.flatMap((p) => [p, `${p}/**`]), ...pages];
}
