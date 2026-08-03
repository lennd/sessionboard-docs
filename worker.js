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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(KB_PREFIX);

    if (match) {
      const slug = (match[1] ?? '').replace(/\/$/, '');
      if (!slug) return Response.redirect(`${url.origin}/`, 301);
      const target = redirects[slug];
      // Unknown KB slugs (drafts, typos) land on the FAQ hub rather than a 404.
      return Response.redirect(`${url.origin}${target ?? '/faq/who-can-i-contact-for-additional-assistance'}`, 301);
    }

    // HubSpot KB sitemap path → Starlight sitemap
    if (url.pathname === '/sitemap.xml') {
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/sitemap-index.xml`, request));
      if (asset.ok) return asset;
    }

    return env.ASSETS.fetch(request);
  },
};
