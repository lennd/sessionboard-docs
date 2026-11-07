/**
 * The API Docs tab's own sidebar, built from the synced Mintlify navigation
 * (src/data/api/nav.json) so its groups and order stay exactly what docs.json says.
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

export function buildApiSidebar({ nav, spec, source, pathname }) {
  const current = norm(pathname);
  const byMethodPath = new Map(listOperations(spec).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]));

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
      const route = guideRoute(entry);
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

  const sidebar = [];
  for (const tab of nav.tabs || []) {
    const groups = (tab.groups || []).map((g) => g);
    const isReference = groups.some((g) => JSON.stringify(g.pages).match(/"(GET|POST|PUT|PATCH|DELETE) \//));
    if (!isReference) {
      // "Documentation": its groups sit at the top level, open.
      for (const g of groups) sidebar.push(group(g.group, g.pages, false));
    } else {
      // "API Reference": one top-level group; the prose pages open, endpoint groups collapsed.
      const inner = groups.map((g) => {
        const endpoints = JSON.stringify(g.pages).match(/"(GET|POST|PUT|PATCH|DELETE) \//);
        return group(g.group, g.pages, !!endpoints);
      });
      sidebar.push({ type: 'group', label: tab.tab, entries: inner, collapsed: false, badge: undefined });
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
