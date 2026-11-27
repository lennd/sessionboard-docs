/**
 * <lastmod> for the generated sitemap.
 *
 * The date is the last commit that touched the page's source, when git can
 * see it. A depth-1 checkout (pull-request CI) only has that one commit, so a
 * page that did not change there falls back to frontmatter `reviewed`. The
 * deploy job checks out full history so the published sitemap uses commit
 * dates. Pages with neither are left without <lastmod> rather than stamped
 * with the build time, which would tell crawlers every URL changed on every
 * deploy.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

export function parseGitNameLog(text) {
  const dates = new Map();
  let current = null;
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (ISO_DATE.test(trimmed)) {
      current = trimmed;
      continue;
    }
    if (current && !dates.has(trimmed)) dates.set(trimmed, current);
  }
  return dates;
}

function readReviewed(absPath) {
  if (!/\.mdx?$/.test(absPath)) return null;
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  const reviewed = front[1].match(/^reviewed:\s*["']?(\d{4}-\d{2}-\d{2})/m);
  return reviewed ? reviewed[1] : null;
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFor(root, rel, gitDates) {
  const git = asDate(gitDates.get(rel));
  if (git) return git;
  const reviewed = readReviewed(join(root, rel));
  return reviewed ? asDate(`${reviewed}T00:00:00Z`) : null;
}

function walk(dir, acc = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function docsPath(rel) {
  let slug = rel.replace(/^src\/content\/docs\//, '').replace(/\.mdx?$/, '');
  if (slug === 'index') return '/';
  if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
  return `/${slug}`;
}

function pagePath(rel) {
  if (rel.includes('[')) return null;
  let slug = rel.replace(/^src\/pages\//, '').replace(/\.astro$/, '');
  if (slug === 'index') return '/';
  if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
  return `/${slug}`;
}

function loadGitDates(root) {
  try {
    const out = execFileSync(
      'git',
      [
        'log',
        '--pretty=format:%cI',
        '--name-only',
        '--',
        'src/content/docs',
        'src/pages',
        'src/api-docs',
        'api-spec/openapi.yaml',
        'src/data/api/products',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return parseGitNameLog(out);
  } catch {
    return new Map();
  }
}

function remember(map, pathname, date) {
  if (!pathname || !date) return;
  const prev = map.get(pathname);
  if (!prev || date > prev) map.set(pathname, date);
}

export function normalizeSitemapPath(url) {
  const path = new URL(url, 'https://learn.sessionboard.com').pathname;
  if (path === '/' || path === '') return '/';
  return path.replace(/\/$/, '').replace(/\.html$/, '');
}

let cached;

/**
 * @param {string} [root]
 * @returns {(url: string) => Date | undefined}
 */
export function createLastmodLookup(root = process.cwd()) {
  root = resolve(root);
  if (cached?.root === root) return cached.lookup;

  const gitDates = loadGitDates(root);
  const byPath = new Map();
  const fileDate = (rel) => dateFor(root, rel, gitDates);
  const relOf = (abs) => relative(root, abs);

  for (const abs of walk(join(root, 'src/content/docs'))) {
    if (!/\.mdx?$/.test(abs)) continue;
    const rel = relOf(abs);
    remember(byPath, docsPath(rel), fileDate(rel));
  }

  for (const abs of walk(join(root, 'src/pages'))) {
    if (!abs.endsWith('.astro')) continue;
    const rel = relOf(abs);
    remember(byPath, pagePath(rel), fileDate(rel));
  }

  let registry = { products: {} };
  try {
    registry = JSON.parse(readFileSync(join(root, 'src/data/api/products.json'), 'utf8'));
  } catch {
    registry = { products: {} };
  }

  const referenceDates = [];
  for (const [key, product] of Object.entries(registry.products ?? {})) {
    if (!product?.sourceDir || !product.base) continue;
    const dir = join(root, 'src/api-docs', product.sourceDir);
    for (const abs of walk(dir)) {
      if (!/\.mdx?$/.test(abs)) continue;
      const rel = relOf(abs);
      const name = rel.slice(`src/api-docs/${product.sourceDir}/`.length).replace(/\.mdx?$/, '');
      const pathname = name === 'index' ? product.base : `${product.base}/${name}`;
      remember(byPath, pathname, fileDate(rel));
    }
    const specRel = `src/data/api/products/${key}/openapi.json`;
    const specDate = fileDate(specRel) || fileDate('api-spec/openapi.yaml');
    if (specDate) referenceDates.push({ prefix: `${product.base}/reference`, date: specDate });
  }

  const platformSpec = fileDate('api-spec/openapi.yaml');

  const lookup = (url) => {
    const pathname = normalizeSitemapPath(url);
    if (byPath.has(pathname)) return byPath.get(pathname);
    if (platformSpec && (pathname === '/api/reference' || pathname.startsWith('/api/reference/'))) return platformSpec;
    for (const { prefix, date } of referenceDates) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return date;
    }
    return undefined;
  };

  cached = { root, lookup };
  return lookup;
}
