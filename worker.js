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

// ── Crawler policy ──────────────────────────────────────────────────────
// The Help Center is a growth surface: we want to rank in search and be cited
// by AI answer engines. So the split is not "bots vs. no bots" — it is
// "engines that send readers back to us" vs. "engines that only absorb our
// content". Anything that answers a user's question and links the source is
// welcome; corpus builders and competitor-recon crawlers are not.

// Send traffic back → allowed. Includes our own SEO tooling (Semrush) and
// HubSpot, whose Breeze agent crawls this domain to answer support chats.
const ALLOWED_BOTS = [
  'Googlebot',
  'Googlebot-Image',
  'Google-Extended', // Gemini grounding — cites sources; no effect on Search rank
  'Bingbot', // also powers Copilot answers
  'Applebot',
  'DuckDuckBot',
  'OAI-SearchBot', // ChatGPT search results
  'ChatGPT-User', // user-initiated fetch in ChatGPT
  'PerplexityBot',
  'Perplexity-User',
  'Claude-SearchBot',
  'Claude-User',
  'MistralAI-User',
  'SemrushBot',
  'SiteAuditBot',
  'HubSpot', // Breeze support agent crawls this domain to answer chats
];

// Absorb without attribution, or exist to profile competitors' content.
// Blocking these costs us no search or AI-citation visibility.
const BLOCKED_BOTS = [
  'GPTBot', // OpenAI model training (distinct from OAI-SearchBot)
  'ClaudeBot', // Anthropic training (distinct from Claude-SearchBot)
  'anthropic-ai',
  'CCBot', // Common Crawl — the corpus everyone else trains on
  'Bytespider',
  'Applebot-Extended',
  'Meta-ExternalAgent',
  'meta-externalagent',
  'FacebookBot',
  'Amazonbot',
  'Diffbot',
  'Omgilibot',
  'omgili',
  'ImagesiftBot',
  'Timpibot',
  'DataForSeoBot', // the rest of this list is competitor-recon tooling
  'AhrefsBot',
  'MJ12bot',
  'DotBot',
  'PetalBot',
  'BLEXBot',
  'SerpstatBot',
  'ZoominfoBot',
  'Scrapy',
];

// robots.txt is advisory, so the denylist is also enforced at the edge.
const BLOCKED_UA_RE = new RegExp(
  BLOCKED_BOTS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
);

// One-request copies of the entire Help Center. Useful to us (we upload
// llms-small.txt to HubSpot from dist/), but they hand a competitor the whole
// corpus in a single GET. Search and AI engines rank us from the HTML pages,
// not from these, so withholding them costs no visibility.
const BULK_EXPORTS = new Set(['/llms.txt', '/llms-full.txt', '/llms-small.txt']);

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

function robotsResponse(isProd) {
  if (!isProd) {
    return textResponse('User-agent: *\nDisallow: /\n');
  }

  const disallowBulk = [...BULK_EXPORTS].map((p) => `Disallow: ${p}`).join('\n');
  const body = [
    '# Sessionboard Help Center',
    '# Search engines and AI assistants that cite their sources are welcome.',
    '# Crawlers that bulk-copy content or profile it for competitors are not.',
    '',
    ALLOWED_BOTS.map((b) => `User-agent: ${b}`).join('\n'),
    'Allow: /',
    disallowBulk,
    '',
    BLOCKED_BOTS.map((b) => `User-agent: ${b}`).join('\n'),
    'Disallow: /',
    '',
    '# Unrecognised crawlers: pages are fair game, bulk exports are not.',
    '# Abuse is handled at the edge, not here.',
    'User-agent: *',
    'Allow: /',
    disallowBulk,
    'Crawl-delay: 10',
    '',
    `Sitemap: https://${PROD_HOST}/sitemap.xml`,
    '',
  ].join('\n');

  return textResponse(body);
}

function textResponse(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isProd = url.hostname === PROD_HOST;

    // robots.txt is served before any gating so crawlers can always read the policy.
    if (url.pathname === '/robots.txt') {
      return robotsResponse(isProd);
    }

    const ua = request.headers.get('User-Agent') ?? '';
    if (BLOCKED_UA_RE.test(ua)) {
      return new Response('Not available to this crawler. See /robots.txt\n', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (BULK_EXPORTS.has(url.pathname)) {
      return new Response('Not found\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
      });
    }

    const match = url.pathname.match(KB_PREFIX);

    if (match) {
      const slug = decodeURIComponent(match[1] ?? '').replace(/\/$/, '');
      if (!slug) return Response.redirect(`${url.origin}/`, 301);
      // Unknown KB slugs (drafts, typos) land on the FAQ hub rather than a 404.
      return Response.redirect(`${url.origin}${resolveKbSlug(slug) ?? FALLBACK}`, 301);
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
