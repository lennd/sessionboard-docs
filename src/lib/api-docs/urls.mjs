/**
 * URLs of the API Docs tab (/api/...), and how every Mintlify URL maps onto them.
 *
 * Used by the pages under src/pages/api/ (endpoint routes, sidebar, links in spec
 * descriptions, which may still use Mintlify-style paths such as /authentication) and by
 * tests/api-docs.test.mjs, which checks the frozen 301 map (src/data/api/mintlify-redirects.json). One function
 * per decision so a URL never has two spellings.
 *
 *   Mintlify (apidocs.sessionboard.com)        Help Center (learn.sessionboard.com)
 *   /introduction                           -> /api
 *   /authentication, /guides/x, /insights/x -> /api/authentication, /api/guides/x, ...
 *   /api-reference/overview                 -> /api/reference/overview
 *   /api-reference/<tag>/<summary>          -> /api/reference/<tag>/<summary>
 *
 * Self-serve products (src/data/api/products.json) get the same shape under their own
 * base inside their Help Center suite: Mintlify `marketing/overview` -> /sessionboard-marketing/api,
 * `marketing/mcp-tools` -> /sessionboard-marketing/api/mcp-tools, endpoints ->
 * /sessionboard-marketing/api/reference/<tag>/<summary>.
 *
 * Endpoint slugs are Mintlify's: the operation's first tag and its summary, slugified.
 * Mintlify keeps "&" in a few tag slugs and drops it in others; we always drop it, and
 * the redirect map lists both spellings.
 */

export const API_BASE = '/api';
export const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Our slug: lowercase, apostrophes dropped, every other run of non-alphanumerics -> "-". */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Loose key used to match a Mintlify slug to an operation whatever its punctuation. */
export function looseKey(text) {
  return String(text).toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, '');
}

/**
 * Route (no leading slash, as Starlight ids are written) for a Mintlify guide page path.
 * With a product registry, a page under a product's `sourceDir` lands under that
 * product's base; its `overview` page is the product's API home.
 */
export function guideRoute(mintPage, registry = null) {
  const p = mintPage.replace(/^\/+|\/+$/g, '').replace(/\.mdx?$/, '');
  for (const conf of Object.values(registry?.products ?? {})) {
    if (!conf.sourceDir || !(p === conf.sourceDir || p.startsWith(`${conf.sourceDir}/`))) continue;
    const rest = p.slice(conf.sourceDir.length).replace(/^\/+/, '');
    const base = conf.base.replace(/^\/+/, '');
    return rest === '' || rest === 'overview' ? base : `${base}/${rest}`;
  }
  if (p === 'introduction' || p === '') return 'api';
  if (p.startsWith('api-reference/')) return `api/reference/${p.slice('api-reference/'.length)}`;
  return `api/${p}`;
}

/**
 * Content-collection file (relative to src/content/docs) for a guide route. The tab's
 * landing page is src/content/docs/api.mdx, not api/index.mdx, so its id, URL and share
 * card are all plain "api" (Head.astro and generate-og.py key cards by id).
 */
export function guideFile(route) {
  return `${route}.mdx`;
}

/** Every operation in spec order: { method, path, op, tag, summary, slug, href }. Slugs are unique. */
export function listOperations(spec, base = API_BASE) {
  const out = [];
  const taken = new Map();
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] || 'Other';
      const summary = op.summary || `${method.toUpperCase()} ${path}`;
      let slug = `${slugify(tag)}/${slugify(summary)}`;
      if (taken.has(slug)) slug = `${slug}-${slugify(op.operationId || `${method}-${path}`)}`;
      taken.set(slug, true);
      out.push({ method, path, op, item, tag, summary, slug, href: `${base}/reference/${slug}` });
    }
  }
  return out;
}

/** Index of operations for link rewriting: "METHOD /path", loose tag/summary keys. */
export function operationIndex(spec, base = API_BASE) {
  const ops = listOperations(spec, base);
  const byMethodPath = new Map();
  const byLoose = new Map();
  for (const o of ops) {
    byMethodPath.set(`${o.method.toUpperCase()} ${o.path}`, o);
    const key = `${looseKey(o.tag)}/${looseKey(o.summary)}`;
    if (!byLoose.has(key)) byLoose.set(key, o);
  }
  return { ops, byMethodPath, byLoose };
}

/**
 * Rewrite one Mintlify-site href to its Help Center equivalent. Returns null when the
 * href is not a Mintlify page (external, mailto, in-page anchor, image).
 */
export const MINTLIFY_HOSTS = ['apidocs.sessionboard.com', 'sessionboard.mintlify.app'];

export function rewriteHref(href, index, { registry = null, fallback = null } = {}) {
  // Absolute links to the Mintlify site become links inside this one.
  const abs = href && href.match(/^https?:\/\/([^/]+)(\/.*)?$/);
  if (abs && MINTLIFY_HOSTS.includes(abs[1])) href = abs[2] && abs[2] !== '/' ? abs[2] : '/introduction';
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  if (href.startsWith('/images/')) return `/images/api/${href.slice('/images/'.length)}`;
  const [pathPart, hash = ''] = href.split('#');
  // Mintlify keeps punctuation such as "—" in heading ids; Starlight (github-slugger) drops it.
  let cleanHash = hash;
  try {
    cleanHash = decodeURIComponent(hash);
  } catch {}
  cleanHash = cleanHash.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
  const anchor = hash ? `#${cleanHash}` : '';
  // Mintlify's "link to the spec" form: /api-reference/openapi.yaml#/paths/<pointer>/<method>
  if (/^\/api-reference\/openapi\.(ya?ml|json)$/.test(pathPart)) {
    const m = hash.match(/^\/paths\/(.+)\/(get|post|put|patch|delete)$/);
    if (!m) return `${API_BASE}/openapi.${pathPart.endsWith('.json') ? 'json' : 'yaml'}`;
    const path = decodeURIComponent(m[1]).replace(/~1/g, '/').replace(/~0/g, '~');
    const key = `${m[2].toUpperCase()} ${path}`;
    const o = index.byMethodPath.get(key) ?? fallback?.byMethodPath.get(key);
    return o ? o.href : null;
  }
  const parts = pathPart.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] === 'api-reference' && parts.length === 3) {
    const key = `${looseKey(parts[1])}/${looseKey(parts[2])}`;
    const o = index.byLoose.get(key) ?? fallback?.byLoose.get(key);
    return o ? `${o.href}${anchor}` : null;
  }
  const route = guideRoute(pathPart, registry);
  return `/${route}${anchor}`;
}

/** Mintlify spellings of an operation's URL (with and without "&" in the tag slug). */
export function mintlifyOperationUrls(o) {
  const summary = String(o.summary).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9&]+/g, '-').replace(/^-+|-+$/g, '');
  const tagWithAmp = String(o.tag).toLowerCase().replace(/\s+/g, '-');
  const urls = new Set([`/api-reference/${slugify(o.tag)}/${slugify(o.summary)}`, `/api-reference/${tagWithAmp}/${summary}`]);
  return [...urls];
}

/** True for /api and every page under it (the API Docs tab). */
export function isApiPath(pathname) {
  return /^\/api(\/|\.html$|$)/.test(pathname);
}
