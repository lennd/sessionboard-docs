/**
 * The API Docs sidebar, organized by task and domain (src/data/api/layout.json) rather than
 * by Mintlify's "Org — X" / "Event — X" groups. Pages and endpoints still come from the
 * synced Mintlify nav, so every URL is unchanged; only where they sit in the sidebar moves.
 *
 *   Get started · Recipes · Guides · Reference (Program, Event setup, People & CRM, …)
 *
 * Each Reference domain has a landing page (<base>/reference/<slug>) with a two-line
 * "what you use this for" and one table per resource that puts organization and event
 * endpoints side by side, each row with its scope (Organization / Event), method and the
 * API-key scope it needs. A self-serve product gets the same shape from its own nav
 * (productLayout). Plain JS: shared by route-data, pages and tests.
 */
import { guideRoute, listOperations, slugify } from './urls.mjs';

const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE) (\/.*)$/;
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '').replace(/\.html$/, '') : p);

/** docs.json group (or subgroup) name → its "METHOD /path" endpoint strings, and every guide page. */
export function navIndex(nav) {
  const groups = new Map();
  const pages = [];
  (function walk(node, group) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, group));
    if (typeof node === 'string') {
      if (ENDPOINT.test(node)) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(node);
      } else pages.push(node);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.tabs) walk(node.tabs, group);
    if (node.groups) walk(node.groups, group);
    if (node.pages) walk(node.pages, node.group ?? group);
  })(nav, null);
  return { groups, pages };
}

/** Organization- or event-level, from the path. */
export const scopeOf = (path) => (/\/event\/\{eventId\}/.test(path) ? 'event' : 'org');
export const SCOPE_LABEL = { org: 'Organization', event: 'Event' };

const isRead = (o) => o.method === 'get' || /search|list|find/i.test(`${o.op.operationId ?? ''} ${o.summary}`);

/** API-key scopes an operation needs: those its description names, else the resource's fallback. */
export function requiredScopes(o, fallback = {}) {
  const named = [...new Set((o.op.description ?? '').match(/\b(?:read|write):[a-z_]+\b/g) ?? [])];
  if (named.length) return named;
  const fb = isRead(o) ? fallback.read : fallback.write;
  return fb ? [fb] : [];
}

/**
 * A self-serve product's layout, derived from its own docs.json tab: its overview,
 * authentication, MCP tools and changelog under Get started, and its endpoint
 * groups as resources of one Reference domain named after the product.
 */
export function productLayout(nav, label) {
  const { groups, pages } = navIndex(nav);
  const by = (suffix) => pages.filter((p) => p.endsWith(`/${suffix}`));
  const known = new Set([...by('overview'), ...by('authentication'), ...by('changelog'), ...by('mcp-tools')]);
  return {
    getStarted: [
      ...by('overview').map((page) => ({ label: 'Overview', page })),
      ...by('authentication').map((page) => ({ label: 'Authentication', page })),
      // MCP sits in Get started, as it does for Platform (Josh, 2026-11-06).
      ...by('mcp-tools').map((page) => ({ label: 'MCP tools', page })),
      ...by('changelog').map((page) => ({ label: 'Changelog', page })),
    ],
    recipes: [],
    guides: pages.filter((p) => !known.has(p)).map((page) => ({ page })),
    reference: [
      {
        slug: slugify(label),
        label,
        about: `Every ${label} API endpoint, grouped by what it works on. Organization- and event-level endpoints sit side by side, with the scope each one needs.`,
        resources: [...groups.keys()].map((g) => ({ label: g, groups: [g] })),
      },
    ],
  };
}

/** The operations of one resource, in nav order, with scope and required API-key scopes. */
export function resourceOperations(resource, { groups }, byMethodPath) {
  return resource.groups
    .flatMap((g) => groups.get(g) ?? [])
    .map((entry) => byMethodPath.get(entry))
    .filter(Boolean)
    .map((o) => ({ ...o, scope: scopeOf(o.path), scopes: requiredScopes(o, resource.scopes) }));
}

/** Everything the domain landing pages render: [{ slug, label, about, href, pages, resources:[{ label, ops }] }]. */
export function referenceDomains({ layout, nav, spec, base = '/api', registry = null, source = {} }) {
  const idx = navIndex(nav);
  const byMethodPath = new Map(listOperations(spec, base).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]));
  return layout.reference.map((d) => ({
    slug: d.slug,
    label: d.label,
    about: d.about,
    href: `${base}/reference/${d.slug}`,
    pages: (d.pages ?? []).map((page) => {
      const route = guideRoute(page, registry);
      return { href: `/${route}`, title: source.guides?.[route]?.label ?? source.guides?.[route]?.title ?? page };
    }),
    resources: d.resources.map((r) => ({ label: r.label, ops: resourceOperations(r, idx, byMethodPath) })),
  }));
}

/** The sidebar (Starlight SidebarEntry[]) for one product's API docs, from its layout. */
export function buildLayoutSidebar({ layout, nav, spec, source = {}, pathname, base = '/api', registry = null }) {
  const current = norm(pathname);
  const link = (label, href, extra = {}) => ({
    type: 'link',
    label,
    href,
    isCurrent: norm(href.split('#')[0]) === current && !href.includes('#'),
    badge: undefined,
    attrs: {},
    ...extra,
  });
  const group = (label, entries, collapsed) => {
    const hasCurrent = JSON.stringify(entries).includes('"isCurrent":true');
    return { type: 'group', label, entries, collapsed: collapsed && !hasCurrent, badge: undefined };
  };
  const pageLink = (item) => {
    if (item.items) return group(item.label, item.items.map(pageLink), false);
    if (item.href) return link(item.label, item.href);
    const route = guideRoute(item.page, registry);
    const meta = source.guides?.[route];
    return link(item.label ?? meta?.label ?? meta?.title ?? item.page, `/${route}`);
  };
  const opLink = (o) =>
    link(o.summary, o.href, {
      badge: { text: o.method.toUpperCase(), variant: { GET: 'success', POST: 'note', PUT: 'caution', PATCH: 'tip', DELETE: 'danger' }[o.method.toUpperCase()] ?? 'default', class: 'api-method' },
      attrs: { class: 'api-op', 'data-method': o.method.toUpperCase(), 'data-scope': o.scope, title: `${SCOPE_LABEL[o.scope]}-level${o.scopes.length ? ` · needs ${o.scopes.join(', ')}` : ''}` },
    });

  const sidebar = [];
  if (layout.getStarted?.length) sidebar.push(group('Get started', layout.getStarted.map(pageLink), false));
  if (layout.recipes?.length) sidebar.push(group('Recipes', layout.recipes.map(pageLink), true));
  if (layout.guides?.length) sidebar.push(group('Guides', layout.guides.map(pageLink), true));
  const domains = referenceDomains({ layout, nav, spec, base, registry, source });
  const reference = domains.map((d) => {
    const entries = [link('Overview', d.href), ...d.pages.map((p) => link(p.title, p.href))];
    for (const r of d.resources) {
      if (!r.ops.length) continue;
      // A domain with a single resource of the same name lists its endpoints directly.
      if (d.resources.length === 1 && r.label === d.label) entries.push(...r.ops.map(opLink));
      else entries.push(group(r.label, r.ops.map(opLink), true));
    }
    return group(d.label, entries, true);
  });
  if (reference.length) sidebar.push(group('Reference', reference, false));
  return sidebar;
}

/** Pages and endpoints of a nav that the layout puts nowhere (tests: must be empty). */
export function unplaced(layout, nav) {
  const { groups, pages } = navIndex(nav);
  const placedPages = new Set();
  const take = (item) => {
    if (item.items) item.items.forEach(take);
    else if (item.page) placedPages.add(item.page);
  };
  [...(layout.getStarted ?? []), ...(layout.recipes ?? []), ...(layout.guides ?? [])].forEach(take);
  const placedGroups = new Set();
  for (const d of layout.reference) {
    (d.pages ?? []).forEach((p) => placedPages.add(p));
    for (const r of d.resources) r.groups.forEach((g) => placedGroups.add(g));
  }
  return {
    pages: pages.filter((p) => !placedPages.has(p)),
    groups: [...groups.keys()].filter((g) => !placedGroups.has(g)),
    unknownGroups: [...placedGroups].filter((g) => !groups.has(g)),
  };
}
