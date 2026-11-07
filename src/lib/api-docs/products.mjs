/**
 * Which products have API docs, which are in this build, and which product a path is in.
 * Registry: src/data/api/products.json. Plain JS, shared by pages, route-data, the Worker,
 * the sync script and the tests.
 */
export const PLATFORM = 'platform';

/** Product keys in registry (switcher) order. */
export const productKeys = (registry) => Object.keys(registry.products);

/**
 * Products built into this site: Platform, every released product, and whatever
 * SB_PREVIEW_SUITES names (`1`/`all`/`true`/`yes` = every product, else a comma list).
 * Same values and semantics as the Help Center suites' builtSuites().
 */
export function builtApiProducts(registry, env = {}) {
  const preview = String(env.SB_PREVIEW_SUITES ?? '').trim().toLowerCase();
  const all = ['1', 'all', 'true', 'yes'].includes(preview);
  const named = new Set(preview.split(',').map((s) => s.trim()).filter(Boolean));
  return new Set(productKeys(registry).filter((k) => k === PLATFORM || registry.products[k].released || all || named.has(k)));
}

/**
 * Products deployed with API docs: every product, unless SB_PUBLIC_SUITES_ONLY.
 * An unreleased product's API pages live under its suite (/sessionboard-<key>/api), which
 * is staff-only until the product ships (src/lib/staff-only.mjs), so staff can read them.
 */
export function deployedApiProducts(registry, env = {}) {
  const publicOnly = ['1', 'true', 'yes'].includes(String(env.SB_PUBLIC_SUITES_ONLY ?? '').trim().toLowerCase());
  return publicOnly ? builtApiProducts(registry, env) : new Set(productKeys(registry));
}

const clean = (p) => {
  let path = String(p ?? '').split(/[?#]/)[0].replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
};

/** The product whose API docs a path belongs to, or null when it is not an API docs page. */
export function apiProductForPath(pathname, registry) {
  const path = clean(pathname);
  for (const key of productKeys(registry)) {
    const base = registry.products[key].base;
    if (path === base || path.startsWith(`${base}/`)) return key;
  }
  return null;
}

/** The product that owns a Mintlify page path (`marketing/overview` → marketing), else Platform. */
export function productForSourcePage(page, registry) {
  const p = String(page).replace(/^\/+/, '');
  for (const key of productKeys(registry)) {
    const dir = registry.products[key].sourceDir;
    if (dir && (p === dir || p.startsWith(`${dir}/`))) return key;
  }
  return PLATFORM;
}

/** The product a docs.json tab belongs to: a product whose `tab` label matches, else Platform. */
export function productForTab(tabName, registry) {
  for (const key of productKeys(registry)) if (registry.products[key].tab === tabName) return key;
  return PLATFORM;
}
