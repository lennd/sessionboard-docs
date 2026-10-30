/**
 * Starlight route middleware: staff-only pages (site.json `staffOnly`) are left
 * out of the Pagefind index, so the public search box never finds them. The
 * Worker hides them everywhere else — see src/lib/staff-only.mjs.
 */
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { isStaffOnlySlug } from './lib/staff-only.mjs';
import site from '../site.json';

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (isStaffOnlySlug(route.id, site)) route.entry.data.pagefind = false;
});
