#!/usr/bin/env node
/**
 * Validates every personalization marker in the corpus against the product
 * contract, without running a build.
 *
 * The Astro components throw on an unknown id too, so this is not the only
 * gate — but it is the fast one. It runs in well under a second, so it can sit
 * in a pre-commit hook and in CI ahead of the build, and it reports every bad
 * marker in the corpus at once rather than failing on the first page Astro
 * happens to compile.
 *
 * It also catches two things a build cannot:
 *
 *   - Raw `data-sb-*` attributes hand-written in MDX. Those bypass the
 *     components entirely, so nothing validates them, and a typo'd attribute is
 *     invisible: it renders fine and simply never hydrates.
 *   - `features:` frontmatter naming a slug that no longer exists, which would
 *     drop the article from retrieval for every customer who owns the feature.
 *
 * Usage:
 *   npm run markers:check
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'src', 'content', 'docs');
const CONTRACT = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'product-contract.json'), 'utf8'),
);

const AUDIENCES = new Set(['organizer', 'reviewer', 'speaker', 'participant']);

const features = new Set(CONTRACT.features);
const settings = new Set(CONTRACT.eventSettings);
const routes = new Set(Object.keys(CONTRACT.appRoutes));

const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/** Line number of a character offset, for an error a human can act on. */
const lineAt = (source, index) => source.slice(0, index).split('\n').length;

function report(file, source, index, message) {
  problems.push(`${relative(ROOT, file)}:${lineAt(source, index)} ${message}`);
}

/** Collect every `attr="value"` occurrence of one attribute on one component. */
function* attrValues(source, component, attr) {
  const re = new RegExp(`<${component}\\b[^>]*?\\b${attr}=(?:"([^"]*)"|'([^']*)')`, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    yield { value: match[1] ?? match[2] ?? '', index: match.index };
  }
}

const tokens = (value) => value.split(/\s+/).filter(Boolean);

for (const file of walk(DOCS).sort()) {
  const source = readFileSync(file, 'utf8');

  for (const { value, index } of attrValues(source, 'IfFeature', 'id')) {
    if (tokens(value).length === 0) report(file, source, index, '<IfFeature> has an empty id');
    for (const slug of tokens(value)) {
      if (!features.has(slug)) {
        report(file, source, index, `<IfFeature id="${slug}"> is not a known feature`);
      }
    }
  }

  for (const { value, index } of attrValues(source, 'IfSetting', 'id')) {
    if (tokens(value).length === 0) report(file, source, index, '<IfSetting> has an empty id');
    for (const id of tokens(value)) {
      if (!settings.has(id)) {
        report(file, source, index, `<IfSetting id="${id}"> is not a known event setting`);
      }
    }
  }

  for (const { value, index } of attrValues(source, 'AddOnNote', 'feature')) {
    if (!features.has(value)) {
      report(file, source, index, `<AddOnNote feature="${value}"> is not a known feature`);
    }
  }

  const appLinkRe = /\]\(app:([^)\s]+)\)/g;
  let link;
  while ((link = appLinkRe.exec(source)) !== null) {
    if (!routes.has(link[1])) {
      report(file, source, link.index, `app:${link[1]} is not a known route target`);
    }
  }

  // Authors write components; the attributes are an output format. A
  // hand-written one is unvalidated and fails silently at runtime.
  const rawAttrRe = /data-sb-[a-z-]+/g;
  let raw;
  while ((raw = rawAttrRe.exec(source)) !== null) {
    report(
      file,
      source,
      raw.index,
      `writes ${raw[0]} by hand — use <IfFeature>, <IfSetting>, <AddOnNote> or an app: link instead`,
    );
  }

  // Frontmatter taxonomy. Only the inline-array form is emitted by
  // taxonomy:tag and used by authors, so that is what is checked.
  const frontEnd = source.indexOf('\n---', 3);
  const front = source.startsWith('---') && frontEnd !== -1 ? source.slice(0, frontEnd) : '';

  const featuresLine = /^features:\s*\[(.*)\]\s*$/m.exec(front);
  for (const slug of (featuresLine?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)) {
    if (!features.has(slug)) {
      report(file, source, 0, `frontmatter features: names unknown feature "${slug}"`);
    }
  }

  const audienceLine = /^audience:\s*\[(.*)\]\s*$/m.exec(front);
  for (const who of (audienceLine?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)) {
    if (!AUDIENCES.has(who)) {
      report(file, source, 0, `frontmatter audience: names unknown audience "${who}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    `\n✖ ${problems.length} invalid marker(s):\n` +
      problems.map((p) => `  ${p}`).join('\n') +
      '\n\n  Valid ids live in src/data/product-contract.json.\n' +
      '  If a feature, setting or route is new, run `npm run contract:pull` and commit the result.\n',
  );
  process.exit(1);
}

console.log(
  `✓ Markers valid against contract v${CONTRACT.contractVersion} ` +
    `(${features.size} features, ${settings.size} settings, ${routes.size} routes).`,
);
