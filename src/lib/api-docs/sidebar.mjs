/**
 * The API Docs tab's own sidebar, built from src/data/api/nav.json (the navigation in
 * Mintlify's docs.json shape, edited by hand here) so its groups and order stay what it says.
 * src/route-data.ts swaps it in for every /api page; the Help Center sidebar
 * (src/sidebar.json) never lists API pages.
 *
 * Returns Starlight SidebarEntry objects ({ type: 'link' | 'group', ... }).
 */
import { listOperations } from './urls.mjs';
import { guideRoute } from './urls.mjs';

export const METHOD_BADGE = {
  GET: 'success',
  POST: 'note',
  PUT: 'caution',
  PATCH: 'tip',
  DELETE: 'danger',
};

const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE) (\/.*)$/;
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '').replace(/\.html$/, '') : p);

export function buildApiSidebar({ nav, spec, source, pathname, base = '/api', registry = null }) {
  const current = norm(pathname);
  const byMethodPath = new Map(listOperations(spec, base).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]));

  const link = (label, href, extra = {}) => ({
    type: 'link',
    label,
    href,
    isCurrent: norm(href) === current,
    badge: undefined,
    attrs: {},
    ...extra,
  });

  function page(entry) {
    if (typeof entry === 'string') {
      const m = entry.match(ENDPOINT);
      if (m) {
        const o = byMethodPath.get(entry);
        if (!o) return null;
        return link(o.summary, o.href, {
          badge: { text: m[1], variant: METHOD_BADGE[m[1]] ?? 'default', class: 'api-method' },
          attrs: { class: 'api-op', 'data-method': m[1] },
        });
      }
      const route = guideRoute(entry, registry);
      const meta = source.guides?.[route];
      return link(meta?.label ?? entry, `/${route}`);
    }
    if (entry && Array.isArray(entry.pages)) return group(entry.group, entry.pages);
    return null;
  }

  function group(label, pages, collapsedByDefault = true) {
    const entries = pages.map(page).filter(Boolean);
    const hasCurrent = JSON.stringify(entries).includes('"isCurrent":true');
    return { type: 'group', label, entries, collapsed: collapsedByDefault && !hasCurrent, badge: undefined };
  }

  const hasEndpoints = (g) => /"(GET|POST|PUT|PATCH|DELETE) \//.test(JSON.stringify(g.pages));
  const sidebar = [];
  for (const tab of nav.tabs || []) {
    const groups = tab.groups || [];
    if (!groups.some(hasEndpoints)) {
      // A guides tab ("Documentation"): its groups sit at the top level, open.
      for (const g of groups) sidebar.push(group(g.group, g.pages, false));
    } else if (groups.every(hasEndpoints) || groups.filter((g) => !hasEndpoints(g)).length > 1 || tab.tab === 'API Reference') {
      // A reference tab: one top-level group; prose groups open, endpoint groups collapsed.
      const inner = groups.map((g) => group(g.group, g.pages, hasEndpoints(g)));
      sidebar.push({ type: 'group', label: tab.tab, entries: inner, collapsed: false, badge: undefined });
    } else {
      // A product tab (guides group + endpoint groups): guides open at the top, endpoints under "API reference".
      for (const g of groups.filter((x) => !hasEndpoints(x))) sidebar.push(group(g.group, g.pages, false));
      const inner = groups.filter(hasEndpoints).map((g) => group(g.group, g.pages, true));
      sidebar.push({ type: 'group', label: 'API reference', entries: inner, collapsed: false, badge: undefined });
    }
  }
  return sidebar;
}

export function flatten(entries) {
  return entries.flatMap((e) => (e.type === 'group' ? flatten(e.entries) : [e]));
}

export function prevNext(sidebar) {
  const links = flatten(sidebar);
  const i = links.findIndex((l) => l.isCurrent);
  if (i < 0) return { prev: undefined, next: undefined };
  const strip = (l) => (l ? { ...l, attrs: {}, badge: undefined } : undefined);
  return { prev: strip(links[i - 1]), next: strip(links[i + 1]) };
}
