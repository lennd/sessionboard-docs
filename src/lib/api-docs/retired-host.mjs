/**
 * The retired Mintlify API docs host (apidocs.sessionboard.com, site.json `retiredApiDocsHosts`).
 * Every path it served 301s to its page under /api on the canonical host, from the frozen map
 * src/data/api/mintlify-redirects.json (all 274 URLs in Mintlify's sitemap, plus the spec files).
 * Anything else on that host (a path Mintlify never listed, an old bookmark) lands on /api.
 *
 * sessionboard.mintlify.app cannot be routed here (Mintlify owns that domain); it goes away
 * when the Mintlify project is deleted.
 */

/** Help Center path for a request path on the retired host. */
export function retiredApiDocsTarget(pathname, redirects) {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {}
  // Mintlify served every page at /<page> and /<page>.md (and with a trailing slash).
  p = p.replace(/\/+$/, '').replace(/\.md$/, '') || '/';
  if (p === '/index') p = '/';
  if (Object.hasOwn(redirects, p)) return redirects[p];
  if (p === '/llms.txt' || p === '/llms-full.txt') return '/api/llms.txt';
  return '/api';
}
