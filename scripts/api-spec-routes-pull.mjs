#!/usr/bin/env node
/**
 * Snapshot the Public API's self-serve product routes from
 * sessionboard-public-api, so `npm run api:check` can fail when a route has
 * no operation in its product's spec (src/data/api/products/<product>/openapi.json).
 *
 * Loads the real Express router (routes/v1) the way the public-api contract
 * tests do: test env, a placeholder database URL (nothing connects; routes
 * register without a query). Writes api-spec/products/routes.json.
 *
 *   npm run api:routes:pull                         # ../sessionboard-public-api
 *   PUBLIC_API_DIR=/path/to/checkout npm run api:routes:pull
 *
 * Re-run after a route is added or removed in sessionboard-public-api and
 * commit the snapshot with the spec change.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRODUCT_ROUTE_PREFIXES, toSpecPath } from './lib/api-product-routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(process.env.PUBLIC_API_DIR || join(root, '..', 'sessionboard-public-api'));
if (!existsSync(join(apiDir, 'routes', 'v1', 'index.js'))) {
  console.error(`No sessionboard-public-api checkout at ${apiDir} (set PUBLIC_API_DIR).`);
  process.exit(1);
}

const list = execFileSync(
  process.execPath,
  [
    '-e',
    `require('./tests/setup/jest.env.js');
     const r = require('routes/v1');
     const out = [];
     for (const l of r.stack) if (l.route) for (const m of Object.keys(l.route.methods)) out.push(m.toUpperCase() + ' ' + l.route.path);
     process.stdout.write(JSON.stringify(out));
     setTimeout(() => process.exit(0), 50);`,
  ],
  {
    cwd: apiDir,
    env: { ...process.env, NODE_PATH: '.', NODE_ENV: 'test', TEST_DB_URL: 'postgres://none:none@127.0.0.1:1/none' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  },
);

const routes = JSON.parse(list);
const products = {};
for (const [product, prefixes] of Object.entries(PRODUCT_ROUTE_PREFIXES)) {
  products[product] = [
    ...new Set(
      routes
        .map((r) => r.split(' '))
        .filter(([, path]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`)))
        .map(([method, path]) => `${method} ${toSpecPath(path)}`),
    ),
  ].sort();
}

const out = join(root, 'api-spec', 'products', 'routes.json');
writeFileSync(out, `${JSON.stringify({ source: 'sessionboard-public-api routes/v1 (npm run api:routes:pull)', products }, null, 2)}\n`);
console.log(`Wrote api-spec/products/routes.json: ${Object.entries(products).map(([p, r]) => `${p} ${r.length}`).join(', ')}`);
