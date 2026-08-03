/**
 * Sessionboard Help Center — Cloudflare Worker.
 *
 * Serves the built Starlight site from ASSETS and 301-redirects legacy
 * HubSpot Knowledge Base URLs (learn.sessionboard.com/en/knowledge-base/<slug>)
 * to their new paths using redirects-map.json (generated from redirects-301.csv
 * by scripts/redirects-to-map.mjs).
 */

import redirects from './redirects-map.json';

const KB_PREFIX = /^\/(?:en\/)?knowledge-base(?:\/(.*))?$/;
const PROD_HOST = 'learn.sessionboard.com';
const FALLBACK = '/faq/who-can-i-contact-for-additional-assistance';

// HubSpot slugs sometimes appear with and without their numeric ID prefix
// (e.g. `9156219-cvent-integration` vs `cvent-integration`). Index both forms;
// prefix-stripped keys are collision-free (verified against the full map).
const strippedRedirects = {};
for (const [slug, target] of Object.entries(redirects)) {
  strippedRedirects[slug.replace(/^\d+-/, '')] = target;
}

function resolveKbSlug(slug) {
  return redirects[slug] ?? strippedRedirects[slug.replace(/^\d+-/, '')] ?? null;
}

function robotsResponse(isProd, origin) {
  const body = isProd
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isProd = url.hostname === PROD_HOST;
    const match = url.pathname.match(KB_PREFIX);

    if (match) {
      const slug = decodeURIComponent(match[1] ?? '').replace(/\/$/, '');
      if (!slug) return Response.redirect(`${url.origin}/`, 301);
      // Unknown KB slugs (drafts, typos) land on the FAQ hub rather than a 404.
      return Response.redirect(`${url.origin}${resolveKbSlug(slug) ?? FALLBACK}`, 301);
    }

    if (url.pathname === '/robots.txt') {
      return robotsResponse(isProd, url.origin);
    }

    // HubSpot KB sitemap path → Starlight sitemap
    if (url.pathname === '/sitemap.xml') {
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/sitemap-index.xml`, request));
      if (asset.ok) return asset;
    }

    const response = await env.ASSETS.fetch(request);

    // Preview hosts (workers.dev) must never be indexed — canonical is learn.
    if (!isProd) {
      const headers = new Headers(response.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  },
};
