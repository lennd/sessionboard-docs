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
  learning: ['/organization/:orgId/learning'],
  awards: ['/organization/:orgId/awards/workspace'],
  marketing: ['/organization/:orgId/marketing'],
};

export const ENFORCED = ['learning', 'awards'];

/**
 * Routes every self-serve product shares and documents (agent sign-up, plans,
 * billing). Snapshotted in their token-org form (`/signup`, `/billing`),
 * which is what the spec documents; the `/organization/:orgId/billing` twin
 * is mentioned in the descriptions.
 */
export const SHARED_ROUTE_PATHS = ['/signup', '/signup/:signupId/verify', '/plans', '/billing', '/billing/card', '/billing/plan'];

/** Express `/organization/:orgId/x/:id` → spec `/v1/organization/{orgId}/x/{id}`. */
export const toSpecPath = (path) => `/v1${path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`;

/** Compare paths regardless of parameter names: `/a/{x}/b` → `/a/{}/b`. */
export const shape = (specPath) => specPath.replace(/\{[^}]+\}/g, '{}');
