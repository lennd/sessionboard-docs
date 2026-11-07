#!/usr/bin/env node
/**
 * Build the Platform API Docs data from its sources in this repo.
 *
 *   npm run api:build     # regenerate after editing the spec, the nav or a guide's title
 *   npm run api:check     # exit 1 if anything generated is stale, then the spec contract (Docs CI)
 *
 * The API docs live here (lennd/sessionboard-public-api-docs and its Mintlify site are retired).
 * Sources, edited by hand:
 *   api-spec/openapi.yaml            the OpenAPI 3.1 spec, single source of truth for every endpoint
 *   src/data/api/nav.json            pages and endpoint groups (Mintlify docs.json navigation shape;
 *                                    the sidebar sections are src/data/api/layout.json)
 *   src/content/docs/api.mdx, src/content/docs/api/**.mdx   guides, changelog, breaking-changes policy
 *
 * Self-serve products (src/data/api/products.json), unreleased until each product ships:
 *   the same api-spec/openapi.yaml: a path belongs to the product whose PRODUCT_PATHS prefix it
 *   matches, else Platform; `x-sb-product` on an operation (a key or a list) overrides that, e.g.
 *   the Learning course operations Platform has always documented say [platform, learning]. The
 *   extension is stripped from every published spec.
 *   src/data/api/products/<key>/nav.json   that product's pages and endpoint groups (docs.json tab shape)
 *   src/api-docs/<key>/*.mdx               its guides (overview = index.mdx)
 *   api-spec/products/routes.json          snapshot of the product routes in sessionboard-public-api
 *                                          (npm run api:routes:pull); api:check fails a Learning or
 *                                          Awards route with no operation, or an operation with no route
 *
 * Generated (never edit by hand):
 *   src/data/api/openapi.json        the spec every endpoint page is built from
 *   public/api/openapi.json          downloadable spec at /api/openapi.json
 *   public/api/openapi.yaml          the same JSON at /api/openapi.yaml (JSON is valid YAML 1.2)
 *   src/data/api/source.json         guide titles for the sidebar, read from each page's frontmatter
 *   src/data/api/products/<key>/{openapi,source}.json   the same, per self-serve product
 *
 * Hidden operations are left out of everything generated. `x-hidden: true` on an operation means
 * "not public yet": the generator drops it, any path left with no operations, any tag only hidden
 * operations used, and any component only they referenced. Components already unreferenced in the
 * YAML are kept, so the filter never touches what is public today.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { guideFile, guideRoute } from '../src/lib/api-docs/urls.mjs';

/**
 * Self-serve products and the paths that are theirs. Everything else is Platform. A new
 * self-serve section adds its prefixes here and its entry in src/data/api/products.json.
 */
export const PRODUCT_PATHS = {
  marketing: [/^\/v1\/marketing(\/|$)/, /^\/v1\/organization\/\{orgId\}\/marketing(\/|$)/],
  learning: [/^\/v1\/learning(\/|$)/, /^\/v1\/organization\/\{orgId\}\/learning(\/|$)/],
  awards: [/^\/v1\/awards\/workspace(\/|$)/, /^\/v1\/organization\/\{orgId\}\/awards\/workspace(\/|$)/],
};

/** The products an operation is published under (see header). */
export function productsOf(path, op) {
  const own = op && op['x-sb-product'];
  if (own) return [].concat(own);
  for (const [product, patterns] of Object.entries(PRODUCT_PATHS)) if (patterns.some((re) => re.test(path))) return [product];
  return ['platform'];
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/** Every `#/components/<kind>/<name>` reachable from `roots`, transitively. */
function reachableComponents(spec, roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/') && !seen.has(value)) {
          seen.add(value);
          const [, , kind, name] = value.split('/');
          const target = spec.components && spec.components[kind];
          if (target && target[name] !== undefined) stack.push(target[name]);
        } else stack.push(value);
      }
    }
  }
  return seen;
}

const rootsOf = (spec) => Object.entries(spec).filter(([k]) => k !== 'components').map(([, v]) => v);

/** Drop `x-hidden` operations, and those `keep(path, op)` refuses, and what only they used. */
export function withoutHiddenOperations(spec, keep = () => true) {
  const before = reachableComponents(spec, rootsOf(spec));
  const out = structuredClone(spec);
  const hiddenTags = new Set();
  const visibleTags = new Set();
  for (const [path, item] of Object.entries(out.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !op) continue;
      const tags = op.tags || [];
      if (op['x-hidden'] === true || !keep(path, op)) {
        tags.forEach((t) => hiddenTags.add(t));
        delete item[method];
      } else tags.forEach((t) => visibleTags.add(t));
    }
    if (!Object.keys(item).some((k) => HTTP_METHODS.has(k))) delete out.paths[path];
  }
  if (Array.isArray(out.tags)) out.tags = out.tags.filter((t) => !(hiddenTags.has(t.name) && !visibleTags.has(t.name)));
  const after = reachableComponents(out, rootsOf(out));
  for (const ref of before) {
    if (after.has(ref)) continue;
    const [, , kind, name] = ref.split('/');
    if (out.components && out.components[kind]) {
      delete out.components[kind][name];
      if (!Object.keys(out.components[kind]).length) delete out.components[kind];
    }
  }
  return out;
}

/** One product's published spec: its operations only, without our `x-sb-product` marks. */
export function productSpec(source, product) {
  const out = withoutHiddenOperations(source, (path, op) => productsOf(path, op).includes(product));
  for (const item of Object.values(out.paths || {})) for (const [m, op] of Object.entries(item)) if (HTTP_METHODS.has(m) && op) delete op['x-sb-product'];
  return out;
}

/** Every non-endpoint page string in a navigation tree is a guide. */
function guidesIn(nav) {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'string') {
      if (!/^(GET|POST|PUT|PATCH|DELETE) \//.test(node)) out.push(node);
      return;
    }
    if (node && typeof node === 'object') for (const k of ['tabs', 'groups', 'pages']) if (node[k]) walk(node[k]);
  })(nav);
  return out;
}

/** title and sidebar.label from a page's frontmatter (flat YAML is all the API guides use). */
function frontmatter(file) {
  const m = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = yaml.load(m[1]) || {};
  return { title: fm.title, label: fm.sidebar?.label, description: fm.description };
}

const problems = [];
const outputs = new Map();

// ---------------------------------------------------------------- spec
const source = yaml.load(readFileSync(join(ROOT, 'api-spec/openapi.yaml'), 'utf8'));
const spec = productSpec(source, 'platform');
const specJson = JSON.stringify(spec, null, 2) + '\n';
outputs.set('src/data/api/openapi.json', specJson);
outputs.set('public/api/openapi.json', specJson);
outputs.set('public/api/openapi.yaml', specJson);

// ---------------------------------------------------------------- guide titles
const nav = JSON.parse(readFileSync(join(ROOT, 'src/data/api/nav.json'), 'utf8'));
const guides = {};
for (const page of guidesIn(nav)) {
  const route = guideRoute(page);
  const rel = `src/content/docs/${guideFile(route)}`;
  if (!existsSync(join(ROOT, rel))) {
    problems.push(`src/data/api/nav.json names "${page}" but ${rel} does not exist`);
    continue;
  }
  const { title, label } = frontmatter(join(ROOT, rel));
  if (!title) problems.push(`${rel} has no title in its frontmatter`);
  guides[route] = { title, label: label || title, source: rel };
}
outputs.set('src/data/api/source.json', JSON.stringify({ '//': 'Generated by scripts/api-spec.mjs (npm run api:build) from src/data/api/nav.json and each guide\'s frontmatter. Do not edit.', guides }, null, 2) + '\n');

// ---------------------------------------------------------------- self-serve products
const registry = JSON.parse(readFileSync(join(ROOT, 'src/data/api/products.json'), 'utf8'));
const productSummary = [];
for (const key of Object.keys(PRODUCT_PATHS)) {
  const conf = registry.products[key];
  const navFile = join(ROOT, `src/data/api/products/${key}/nav.json`);
  if (!conf || !existsSync(navFile)) continue;
  const pSpec = productSpec(source, key);
  outputs.set(`src/data/api/products/${key}/openapi.json`, JSON.stringify(pSpec, null, 2) + '\n');
  const base = conf.base.replace(/^\//, '');
  const pGuides = {};
  for (const page of guidesIn(JSON.parse(readFileSync(navFile, 'utf8')))) {
    const route = guideRoute(page, registry);
    const sub = route === base ? 'index' : route.slice(base.length + 1);
    const rel = `src/api-docs/${key}/${sub}.mdx`;
    if (!existsSync(join(ROOT, rel))) {
      problems.push(`src/data/api/products/${key}/nav.json names "${page}" but ${rel} does not exist`);
      continue;
    }
    const { title, label, description } = frontmatter(join(ROOT, rel));
    if (!title) problems.push(`${rel} has no title in its frontmatter`);
    pGuides[route] = { title, label: label || title, description: description ?? null, source: rel };
  }
  outputs.set(`src/data/api/products/${key}/source.json`, JSON.stringify({ '//': 'Generated by scripts/api-spec.mjs (npm run api:build). Do not edit.', guides: pGuides }, null, 2) + '\n');
  productSummary.push(`${key} ${Object.keys(pSpec.paths || {}).length} paths`);
}

if (problems.length) {
  console.error('api-spec: ' + problems.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------- write / check
const paths = Object.keys(spec.paths || {}).length;
if (CHECK) {
  const stale = [...outputs].filter(([rel, data]) => !existsSync(join(ROOT, rel)) || readFileSync(join(ROOT, rel), 'utf8') !== data).map(([rel]) => rel);
  if (stale.length) {
    console.error(`API docs data is stale (run \`npm run api:build\` and commit the result):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`API docs data is in sync (${paths} paths, ${Object.keys(guides).length} guides${productSummary.length ? `; ${productSummary.join(', ')}` : ''}).`);
} else {
  for (const [rel, data] of outputs) writeFileSync(join(ROOT, rel), data);
  console.log(`api-spec: wrote ${outputs.size} files (${paths} paths, ${Object.keys(guides).length} guides${productSummary.length ? `; ${productSummary.join(', ')}` : ''}).`);
}
