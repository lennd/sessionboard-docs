/**
 * The API docs data each product's pages render from, for products in this build only.
 * Platform: src/data/api/*.json (synced from Mintlify). Self-serve products:
 * src/data/api/products/<key>/*.json and src/api-docs/<key>/*.mdx (scripts/api-docs-sync.mjs).
 * Build-time only (Astro pages, components, route middleware).
 */
import registry from '../../data/api/products.json';
import platformSpec from '../../data/api/openapi.json';
import platformNav from '../../data/api/nav.json';
import platformSource from '../../data/api/source.json';
import { PLATFORM, apiProductForPath, builtApiProducts, productKeys } from './products.mjs';
import { operationIndex } from './urls.mjs';

type Json = Record<string, any>;
export interface ApiProduct {
  key: string;
  label: string;
  base: string;
  help: string;
  spec: Json;
  nav: Json;
  source: Json;
}

const specs = import.meta.glob<Json>('../../data/api/products/*/openapi.json', { eager: true, import: 'default' });
const navs = import.meta.glob<Json>('../../data/api/products/*/nav.json', { eager: true, import: 'default' });
const sources = import.meta.glob<Json>('../../data/api/products/*/source.json', { eager: true, import: 'default' });

export { registry };
export const BUILT = builtApiProducts(registry, process.env);

const cache = new Map<string, ApiProduct | null>();

/** A product's API docs, or null when it is not in this build or has not been synced. */
export function apiProduct(key: string): ApiProduct | null {
  if (cache.has(key)) return cache.get(key)!;
  const conf = (registry.products as Record<string, Json>)[key];
  let out: ApiProduct | null = null;
  if (conf && BUILT.has(key)) {
    if (key === PLATFORM) out = { key, label: conf.label, base: conf.base, help: conf.help, spec: platformSpec, nav: platformNav, source: platformSource };
    else {
      const at = (glob: Record<string, Json>, file: string) => glob[`../../data/api/products/${key}/${file}`];
      const spec = at(specs, 'openapi.json');
      if (spec) out = { key, label: conf.label, base: conf.base, help: conf.help, spec, nav: at(navs, 'nav.json'), source: at(sources, 'source.json') };
    }
  }
  cache.set(key, out);
  return out;
}

/** Products with API docs in this build, in registry (switcher) order. */
export const builtProducts = (): ApiProduct[] => productKeys(registry).map(apiProduct).filter(Boolean) as ApiProduct[];

/** The built product whose API docs a path belongs to, or null. */
export const apiProductAt = (pathname: string): ApiProduct | null => {
  const key = apiProductForPath(pathname, registry);
  return key ? apiProduct(key) : null;
};

const indexes = new Map<string, ReturnType<typeof operationIndex>>();
/** Operation index for link rewriting in a product's descriptions (Platform's for fallback). */
export function indexFor(key: string) {
  if (!indexes.has(key)) {
    const p = apiProduct(key);
    indexes.set(key, operationIndex(p?.spec ?? platformSpec, p?.base ?? '/api'));
  }
  return indexes.get(key)!;
}
