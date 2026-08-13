/**
 * Sessionboard Help Center — Cloudflare Worker.
 *
 * Serves the built Starlight site from ASSETS and 301-redirects legacy
 * HubSpot Knowledge Base URLs (learn.sessionboard.com/en/knowledge-base/<slug>)
 * to their new paths using redirects-map.json (generated from redirects-301.csv
 * by scripts/redirects-to-map.mjs).
 */

import redirects from './redirects-map.json';
import site from './site.json';

// `/en/migrated/knowledge-base/…` is a live path prefix left over from an
// earlier HubSpot migration; Google still has URLs under it.
const KB_PREFIX = /^\/(?:en\/)?(?:migrated\/)?knowledge-base(?:\/(.*))?$/;
const FALLBACK = '/faq/who-can-i-contact-for-additional-assistance';

// The Help Center lives on help.sessionboard.com. `learn` is the old HubSpot
// hostname: HubSpot still holds it as a Cloudflare-for-SaaS custom hostname, so
// we cannot serve it yet (Cloudflare answers 1034). Once a HubSpot admin detaches
// it and it is routed here, every request 301s to the same path on the canonical
// host in a single hop — so the cutover needs DNS only, no code change.
const PROD_HOST = site.canonicalHost;
const LEGACY_HOSTS = new Set(site.legacyHosts);

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

// ── Machine surface ─────────────────────────────────────────────────────
// dist/_internal/help-index.json is the whole corpus, chunked, that web-api
// pulls in to embed for Team Lead. The ASSETS binding would happily serve it to
// anyone who guessed the path — it is the single most valuable bulk export on
// the site — so every /_internal/ request needs a bearer token.
const INTERNAL_PREFIX = '/_internal/';

/**
 * Compare a presented token against the configured one without leaking its
 * length or matching prefix through response timing. Workers has no
 * timingSafeEqual, so both sides are SHA-256'd to a fixed width first and the
 * digests compared with a branch-free loop.
 */
async function tokenMatches(presented, expected) {
  if (!presented || !expected) return false;
  const digest = async (value) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Serve the machine index to an authorized caller.
 *
 * A wrong or missing token gets the same 404 an unknown path would, so probing
 * cannot confirm the endpoint exists. Deliberately absent from robots.txt for
 * the same reason — a Disallow line would advertise the path, and the token is
 * the actual control. Never cached: the sync job diffs by contentHash and a
 * stale edge copy would silently pin retrieval to an old corpus.
 */
async function internalResponse(request, url, env) {
  const presented = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const notFound = new Response('Not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });

  if (!(await tokenMatches(presented, env.HELP_INDEX_TOKEN))) return notFound;

  const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!asset.ok) return notFound;

  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(asset.body, { status: 200, headers });
}

// HubSpot slugs sometimes appear with and without their numeric ID prefix
// (e.g. `9156219-cvent-integration` vs `cvent-integration`). Index both forms;
// prefix-stripped keys are collision-free (verified against the full map).
const strippedRedirects = {};
// HubSpot renames article slugs while keeping the numeric article ID, and it
// serves its own 301s for the old text (`6284057-create-assign-tasks` →
// `6284057-assign-tasks`). Indexing by ID means a rename resolves without
// anyone having to notice it happened, and it also absorbs the punctuation
// variants Google has indexed (`can-t` vs `can't` vs `cant`).
const byArticleId = {};
for (const [slug, target] of Object.entries(redirects)) {
  strippedRedirects[slug.replace(/^\d+-/, '')] = target;
  const id = slug.match(/^(\d+)-/)?.[1];
  if (id) byArticleId[id] = target;
}

// Release notes are not maintained here any more. Sixteen monthly pages had
// drifted more than a year out of date, and the changelog is published on Canny,
// which is already linked from the home page. Everything that used to be under
// /release-notes goes there instead of rotting or 404ing — including the 18
// legacy HubSpot slugs whose redirect targets were those pages.
const CHANGELOG = 'https://feedback.sessionboard.com/changelog';
const RELEASE_NOTES_PREFIX = /^\/release-notes(?:\/|$)/;

function resolveKbSlug(rawSlug) {
  // HubSpot serves 301s to doubled paths for a few articles
  // (`/en/knowledge-base/en/knowledge-base/<slug>`), which Google has indexed.
  const slug = rawSlug.replace(/^(?:en\/)?(?:migrated\/)?knowledge-base\//, '');
  const id = slug.match(/^(\d+)-/)?.[1];
  return (
    redirects[slug] ??
    strippedRedirects[slug.replace(/^\d+-/, '')] ??
    (id ? byArticleId[id] : null) ??
    null
  );
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
    const isLegacyHost = LEGACY_HOSTS.has(url.hostname);
    const isProd = url.hostname === PROD_HOST || isLegacyHost;

    // robots.txt is served before any gating so crawlers can always read the policy.
    if (url.pathname === '/robots.txt') {
      return robotsResponse(isProd);
    }

    // Ahead of the crawler gate: this is a service-to-service call, and it must
    // not be judged by a User-Agent it does not set.
    if (url.pathname.startsWith(INTERNAL_PREFIX)) {
      return internalResponse(request, url, env);
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

    // A request on the legacy host resolves its legacy KB path and lands on the
    // canonical host in one hop, rather than chaining two 301s.
    const targetOrigin = isLegacyHost ? `https://${PROD_HOST}` : url.origin;

    const match = url.pathname.match(KB_PREFIX);

    if (match) {
      const slug = decodeURIComponent(match[1] ?? '').replace(/\/$/, '');
      if (!slug) return Response.redirect(`${targetOrigin}/`, 301);
      // Unknown KB slugs (drafts, typos) land on the FAQ hub rather than a 404.
      const resolved = resolveKbSlug(slug) ?? FALLBACK;
      // Resolved here rather than after the redirect, so a legacy release-notes
      // URL reaches the changelog in one hop instead of bouncing through a path
      // that no longer exists.
      if (RELEASE_NOTES_PREFIX.test(resolved)) return Response.redirect(CHANGELOG, 301);
      return Response.redirect(`${targetOrigin}${resolved}`, 301);
    }

    if (RELEASE_NOTES_PREFIX.test(url.pathname)) {
      return Response.redirect(CHANGELOG, 301);
    }

    if (isLegacyHost) {
      return Response.redirect(`${targetOrigin}${url.pathname}${url.search}`, 301);
    }

    // Legacy links point at /path.html. The assets handler answers those with a
    // 307 to the clean URL, which is a temporary redirect and passes no ranking
    // signal on to the page that replaced it — so redirect permanently here.
    if (url.pathname.endsWith('.html')) {
      const clean = url.pathname.replace(/\/?index\.html$/, '/').replace(/\.html$/, '');
      return Response.redirect(`${targetOrigin}${clean || '/'}${url.search}`, 301);
    }

    // HubSpot KB sitemap path → Starlight sitemap
    if (url.pathname === '/sitemap.xml') {
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/sitemap-index.xml`, request));
      if (asset.ok) return asset;
    }

    const response = await env.ASSETS.fetch(request);

    // Preview hosts (workers.dev) must never be indexed — canonical is help.
    if (!isProd) {
      const headers = new Headers(response.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  },
};
