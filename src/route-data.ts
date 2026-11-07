/**
 * Starlight route middleware.
 *
 * 1. Staff-only pages (site.json `staffOnly`) are left out of the Pagefind index, so the
 *    public search box never finds them. The Worker hides them everywhere else — see
 *    src/lib/staff-only.mjs.
 * 2. API docs pages (Platform's /api, and each built self-serve product's
 *    /sessionboard-<key>/api) get their product's own sidebar and prev/next links, built
 *    from the synced Mintlify navigation (src/lib/api-docs/sidebar.mjs). The Help Center
 *    sidebar (src/sidebar.json) is untouched and never lists API pages.
 *    `locals.sbApiProduct` tells other components (the suite sidebar, the header) which
 *    product's API docs this page belongs to.
 */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { isStaffOnlySlug } from './lib/staff-only.mjs';
import { prevNext } from './lib/api-docs/sidebar.mjs';
import { apiProductAt, apiSidebarFor } from './lib/api-docs/data';
import site from '../site.json';

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (isStaffOnlySlug(route.id, site)) route.entry.data.pagefind = false;

  const P = apiProductAt(context.url.pathname);
  if (P) {
    (context.locals as Record<string, unknown>).sbApiProduct = P.key;
    const sidebar = apiSidebarFor(P.key, context.url.pathname);
    route.sidebar = sidebar as typeof route.sidebar;
    route.hasSidebar = true;
    const { prev, next } = prevNext(sidebar);
    route.pagination = { prev, next } as typeof route.pagination;
  }
});
