/**
 * Starlight route middleware.
 *
 * 1. Staff-only pages (site.json `staffOnly`) are left out of the Pagefind index, so the
 *    public search box never finds them. The Worker hides them everywhere else — see
 *    src/lib/staff-only.mjs.
 * 2. The API Docs tab (/api and everything under it) gets its own sidebar and prev/next
 *    links, built from the synced Mintlify navigation (src/lib/api-docs/sidebar.mjs). The
 *    Help Center sidebar (src/sidebar.json) is untouched and never lists API pages.
 */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { isStaffOnlySlug } from './lib/staff-only.mjs';
import { buildApiSidebar, prevNext } from './lib/api-docs/sidebar.mjs';
import { isApiPath } from './lib/api-docs/urls.mjs';
import site from '../site.json';
import nav from './data/api/nav.json';
import spec from './data/api/openapi.json';
import source from './data/api/source.json';

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (isStaffOnlySlug(route.id, site)) route.entry.data.pagefind = false;

  if (isApiPath(context.url.pathname)) {
    const sidebar = buildApiSidebar({ nav, spec, source, pathname: context.url.pathname });
    route.sidebar = sidebar as typeof route.sidebar;
    route.hasSidebar = true;
    const { prev, next } = prevNext(sidebar);
    route.pagination = { prev, next } as typeof route.pagination;
  }
});
