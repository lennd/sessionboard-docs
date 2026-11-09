/**
 * Which Public API routes belong to which self-serve product, for the route
 * snapshot (scripts/api-spec-routes-pull.mjs) and its check (scripts/api-spec-routes-check.mjs).
 * Only the `/organization/:orgId/...` form is snapshotted; every route here is
 * also served without the org (org from the token), which the spec mentions
 * in each description instead of documenting twice.
 *
 * ENFORCED products fail the check when a route has no operation. Marketing
 * is reported, not enforced, until its sections are all documented.
 */
export const PRODUCT_ROUTE_PREFIXES = {
  // `/sites` is the one Site builder, shared by all three products: each
  // documents it in its own section (`x-sb-product` on the operations).
  learning: ['/organization/:orgId/learning', '/organization/:orgId/sites'],
  awards: ['/organization/:orgId/awards/workspace', '/organization/:orgId/sites'],
  marketing: ['/organization/:orgId/marketing', '/organization/:orgId/sites'],
  sessions: ['/organization/:orgId/sessions-workspace'],
  crm: ['/organization/:orgId/crm'],
};

export const ENFORCED = ['learning', 'awards', 'sessions', 'crm'];

/** Express `/organization/:orgId/x/:id` → spec `/v1/organization/{orgId}/x/{id}`. */
export const toSpecPath = (path) => `/v1${path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`;

/** Compare paths regardless of parameter names: `/a/{x}/b` → `/a/{}/b`. */
export const shape = (specPath) => specPath.replace(/\{[^}]+\}/g, '{}');
