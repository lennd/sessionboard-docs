/**
 * Intercom article URLs on support.sessionboard.com.
 *
 * A Cloudflare Page Rule used to forward `/en/articles/<slug>` to
 * `/en/knowledge-base/<slug>`, and the Worker already maps that HubSpot shape
 * to the canonical article. Rewriting to the knowledge-base path first lets
 * that one resolver finish the hop, including when the Page Rule is gone.
 *
 * Any other path is left alone so the legacy-host redirect can keep it
 * (`/get-started/overview` stays `/get-started/overview`).
 */

export function articlesToKnowledgeBase(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/^\/en\/articles(?:\/(.*))?$/);
  if (!match) return null;
  let slug = match[1] ?? '';
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Broken percent-encoding: resolve the raw segment rather than dropping the redirect.
  }
  slug = slug.replace(/\/+$/, '');
  if (!slug) return '/en/knowledge-base';
  return `/en/knowledge-base/${slug}`;
}
