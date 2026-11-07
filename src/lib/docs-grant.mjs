/**
 * Staff-granted documentation access (web-api lib/help-docs/docs-access.js).
 *
 * Sessionboard staff can give anyone read access to chosen product docs and
 * the API docs until a date. /help/reader/me then carries `docs_grant`
 * ({ granted_by, products, api_docs, expires_at }) and, for someone with no
 * Sessionboard account, `signed_in_via: 'docs_grant'`. The account menu says
 * so in one line.
 */

/** `docs_grant` as page script may see it, or null when it is missing or malformed. */
export function normalizeDocsGrant(value) {
  if (!value || typeof value !== 'object') return null;
  const expires = new Date(value.expires_at);
  if (Number.isNaN(expires.getTime())) return null;
  return {
    products: Array.isArray(value.products) ? value.products.filter((p) => typeof p === 'string') : [],
    api_docs: value.api_docs === true,
    expires_at: expires.toISOString(),
  };
}

/** "Access granted by Sessionboard until November 6, 2027", or null. */
export function docsGrantLine(grant, locale = 'en-US') {
  const g = normalizeDocsGrant(grant);
  if (!g) return null;
  const until = new Date(g.expires_at).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `Access granted by Sessionboard until ${until}`;
}
