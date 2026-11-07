#!/usr/bin/env node
/**
 * Every self-serve product route in the Public API has an operation in its
 * product's spec, and every operation documents a route that exists.
 *
 * Reads the committed snapshot (api-spec/products/routes.json, from
 * `npm run api:routes:pull`) and src/data/api/products/<product>/openapi.json (from
 * `npm run api:build`). Fails for the ENFORCED products (Learning, Awards);
 * lists Marketing's undocumented routes without failing.
 *
 *   npm run api:check  (Docs CI)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENFORCED, shape } from './lib/api-product-routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP = ['get', 'put', 'post', 'delete', 'patch'];

export function compare(snapshotRoutes, spec) {
  const documented = new Set();
  for (const [path, item] of Object.entries(spec?.paths || {})) {
    for (const m of HTTP) if (item[m]) documented.add(`${m.toUpperCase()} ${shape(path)}`);
  }
  const routes = new Set(snapshotRoutes.map((r) => { const [m, p] = r.split(' '); return `${m} ${shape(p)}`; }));
  return {
    undocumented: [...routes].filter((r) => !documented.has(r)).sort(),
    stale: [...documented].filter((r) => !routes.has(r)).sort(),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const snapshot = JSON.parse(readFileSync(join(root, 'api-spec', 'products', 'routes.json'), 'utf8')).products;
  let failed = false;
  for (const [product, routes] of Object.entries(snapshot)) {
    const file = join(root, 'src', 'data', 'api', 'products', product, 'openapi.json');
    const spec = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { paths: {} };
    const { undocumented, stale } = compare(routes, spec);
    const enforced = ENFORCED.includes(product);
    if (enforced && (undocumented.length || stale.length)) failed = true;
    const tag = enforced ? '✖' : 'ℹ';
    if (undocumented.length) console.log(`${tag} ${product}: ${undocumented.length} route(s) without an operation\n  ${undocumented.join('\n  ')}`);
    if (stale.length) console.log(`${tag} ${product}: ${stale.length} operation(s) for a route that does not exist\n  ${stale.join('\n  ')}`);
    if (!undocumented.length && !stale.length) console.log(`✓ ${product}: ${routes.length} routes, all documented`);
  }
  if (failed) {
    console.error('\nAdd the operations to api-spec/openapi.yaml, run `npm run api:build`, and re-run. A route added or removed in sessionboard-public-api: `npm run api:routes:pull` first.');
    process.exit(1);
  }
}
