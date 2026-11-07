#!/usr/bin/env node
/**
 * Sync the Platform Public API docs from lennd/sessionboard-public-api-docs (Mintlify)
 * into the Help Center's API Docs tab (/api/...).
 *
 *   node scripts/api-docs-sync.mjs                      # read ../sessionboard-public-api-docs working tree
 *   node scripts/api-docs-sync.mjs --from <dir>         # another checkout (CI: the checked-out repo)
 *   node scripts/api-docs-sync.mjs --ref origin/main    # read a git ref instead of the working tree
 *   node scripts/api-docs-sync.mjs --check              # exit 1 if anything here differs from the source
 *
 * That repo stays the single source until the Mintlify site is retired: the OpenAPI spec,
 * the navigation (docs.json) and every guide page. Nothing under the paths below is edited
 * by hand — change it there, then re-run this (the API docs sync workflow does it in CI).
 *
 * Writes:
 *   src/data/api/openapi.json        the spec every endpoint page is generated from
 *   src/data/api/nav.json            docs.json navigation (sidebar order and groups)
 *   src/data/api/source.json         source commit + guide titles for the sidebar
 *   src/data/api/mintlify-redirects.json   301 map, Mintlify URL -> Help Center URL (not enabled)
 *   src/content/docs/api/**.mdx      guide pages, converted from Mintlify MDX
 *   public/api/openapi.{yaml,json}   downloadable spec
 *   public/images/api/*              images the guides use
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideFile, guideRoute, listOperations, mintlifyOperationUrls, operationIndex, rewriteHref } from '../src/lib/api-docs/urls.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CHECK = args.includes('--check');
const REF = opt('--ref');
const workspaceGuess = [path.join(ROOT, '..', 'sessionboard-public-api-docs'), path.join(ROOT, '..', '..', 'sessionboard-public-api-docs')].find((p) => fs.existsSync(p));
const FROM = path.resolve(opt('--from') ?? process.env.SB_PUBLIC_API_DOCS_DIR ?? workspaceGuess ?? '');
if (!FROM || !fs.existsSync(FROM)) {
  console.error('api-docs-sync: no source checkout. Pass --from <sessionboard-public-api-docs> or set SB_PUBLIC_API_DOCS_DIR.');
  process.exit(2);
}

const git = (...a) => execFileSync('git', ['-C', FROM, ...a], { encoding: 'buffer', maxBuffer: 64 << 20 });
const readSource = (rel) => (REF ? git('show', `${REF}:${rel}`) : fs.readFileSync(path.join(FROM, rel)));
const sourceExists = (rel) => {
  if (!REF) return fs.existsSync(path.join(FROM, rel));
  try {
    git('cat-file', '-e', `${REF}:${rel}`);
    return true;
  } catch {
    return false;
  }
};
let commit = null;
try {
  commit = git('rev-parse', REF ?? 'HEAD').toString().trim();
} catch {}

// ---------------------------------------------------------------- outputs
const outputs = new Map(); // repo-relative path -> Buffer|string
const put = (rel, data) => outputs.set(rel, data);
const OWNED_DIRS = ['src/content/docs/api', 'public/images/api'];

// ---------------------------------------------------------------- spec + nav
const specYaml = readSource('api-reference/openapi.yaml');
const specJsonBuf = readSource('api-reference/openapi.json');
const spec = JSON.parse(specJsonBuf.toString('utf8'));
const docs = JSON.parse(readSource('docs.json').toString('utf8'));
const index = operationIndex(spec);

put('src/data/api/openapi.json', JSON.stringify(spec, null, 2) + '\n');
put('public/api/openapi.yaml', specYaml);
put('public/api/openapi.json', JSON.stringify(spec, null, 2) + '\n');
put('src/data/api/nav.json', JSON.stringify(docs.navigation, null, 2) + '\n');

// Every non-endpoint page string in the navigation is a guide.
const guidePages = [];
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (typeof node === 'string') {
    if (!/^(GET|POST|PUT|PATCH|DELETE) \//.test(node)) guidePages.push(node);
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of ['tabs', 'groups', 'pages']) if (node[k]) walk(node[k]);
  }
})(docs.navigation);

// ---------------------------------------------------------------- MDX conversion
const COMPAT = ['Note', 'Tip', 'Warning', 'Info', 'Steps', 'Step', 'Card', 'CardGroup', 'Accordion', 'AccordionGroup'];
const images = new Set();
const unresolved = [];

function splitFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { fm, body: src.slice(m[0].length) };
}

const yamlString = (s) => JSON.stringify(String(s));

/** Mintlify fence meta "bash cURL" -> lang "bash" + title "cURL". */
function fenceInfo(info) {
  const m = info.trim().match(/^(\S+)\s+(.+)$/);
  if (!m || /[={}]/.test(m[2])) return { lang: info.trim(), title: null };
  return { lang: m[1], title: m[2].trim() };
}

function convertBody(body, file) {
  // Code fences first, so nothing below touches code. Track fences line by line.
  const lines = body.split('\n');
  const out = [];
  let inFence = false;
  let fenceIndent = '';
  let inCodeGroup = false;
  let groupOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^(\s*)```(.*)$/);
    if (!inFence && /^\s*<CodeGroup>\s*$/.test(line)) {
      inCodeGroup = true;
      out.push(line.replace('<CodeGroup>', '<Tabs syncKey="api-code">'));
      continue;
    }
    if (!inFence && /^\s*<\/CodeGroup>\s*$/.test(line)) {
      if (groupOpen) out.push(`${fenceIndent}</TabItem>`);
      groupOpen = false;
      inCodeGroup = false;
      out.push(line.replace('</CodeGroup>', '</Tabs>'));
      continue;
    }
    if (fence && !inFence) {
      inFence = true;
      fenceIndent = fence[1];
      const { lang, title } = fenceInfo(fence[2]);
      if (inCodeGroup) {
        if (groupOpen) out.push(`${fenceIndent}</TabItem>`);
        out.push(`${fenceIndent}<TabItem label=${yamlString(title || lang || 'Code')}>`);
        groupOpen = true;
        out.push(`${fenceIndent}\`\`\`${lang}`);
      } else {
        out.push(`${fenceIndent}\`\`\`${lang}${title ? ` title=${yamlString(title)}` : ''}`);
      }
      continue;
    }
    if (fence && inFence && fence[2].trim() === '') {
      inFence = false;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(convertProse(line, file));
  }
  return out.join('\n');
}

function convertProse(line, file) {
  let s = line
    .replace(/<Tab(\s+)title=/g, '<TabItem$1label=')
    .replace(/<\/Tab>/g, '</TabItem>')
    // Mintlify icons are Font Awesome names; the Help Center cards have no icon set.
    .replace(/(<Card\b[^>]*?)\s+icon="[^"]*"/g, '$1');
  // Links and images outside inline code.
  s = s.replace(/(`[^`]*`)|(\]\()([^)\s]+)(\))|(href=")([^"]+)(")/g, (m, code, a1, href1, a2, h1, href2, h2) => {
    if (code) return code;
    const href = href1 ?? href2;
    const next = rewriteHref(href, index);
    if (href.startsWith('/images/')) images.add(href.slice('/images/'.length));
    if (next === null) {
      if (href.startsWith('/')) unresolved.push(`${file}: ${href}`);
      return m;
    }
    return href1 !== undefined ? `${a1}${next}${a2}` : `${h1}${next}${h2}`;
  });
  // MDX reads {name} in prose as a JS expression (Mintlify did not): escape path
  // placeholders such as {eventId} outside inline code. "={x}" is a JSX attribute; leave it.
  s = s.replace(/(`[^`]*`)|(^|[^=\\])\{([A-Za-z_][\w.-]*)\}/g, (m, code, pre, name) => (code ? code : `${pre}\\{${name}\\}`));
  return s;
}

const guideTitles = {};
for (const page of guidePages) {
  const rel = `${page}.mdx`;
  if (!sourceExists(rel)) {
    unresolved.push(`docs.json names ${page} but ${rel} does not exist`);
    continue;
  }
  const { fm, body } = splitFrontmatter(readSource(rel).toString('utf8'));
  const route = guideRoute(page);
  const converted = convertBody(body, rel);
  const used = COMPAT.filter((c) => new RegExp(`<${c}[\\s>/]`).test(converted));
  const usesTabs = /<Tabs[\s>]/.test(converted);
  const imports = [
    used.length ? `import { ${used.join(', ')} } from '@compat';` : null,
    usesTabs ? `import { Tabs, TabItem } from '@astrojs/starlight/components';` : null,
  ].filter(Boolean);
  const title = fm.title || page;
  guideTitles[route] = { title, label: fm.sidebarTitle || title, source: rel };
  const head = [
    '---',
    `title: ${yamlString(title)}`,
    fm.description ? `description: ${yamlString(fm.description)}` : null,
    '---',
    '',
    ...imports,
    imports.length ? '' : null,
    `{/* Generated by scripts/api-docs-sync.mjs from lennd/sessionboard-public-api-docs ${rel}. Edit it there and re-sync. */}`,
    '',
  ].filter((l) => l !== null);
  put(`src/content/docs/${guideFile(route)}`, head.join('\n') + converted.replace(/^\n+/, ''));
}

for (const img of images) put(`public/images/api/${img}`, readSource(`images/${img}`));

// ---------------------------------------------------------------- 301 map
const redirects = {};
for (const page of guidePages) redirects[`/${page}`] = `/${guideRoute(page)}`;
redirects['/'] = '/api';
for (const o of listOperations(spec)) for (const u of mintlifyOperationUrls(o)) redirects[u] ??= o.href;
redirects['/api-reference/openapi.yaml'] = '/api/openapi.yaml';
redirects['/api-reference/openapi.json'] = '/api/openapi.json';
put(
  'src/data/api/mintlify-redirects.json',
  JSON.stringify(
    {
      '//': 'Mintlify (apidocs.sessionboard.com, sessionboard.mintlify.app) path -> Help Center path. NOT enabled anywhere: Josh decides when the Mintlify site 301s here. Generated by scripts/api-docs-sync.mjs.',
      redirects: Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + '\n',
);

put('src/data/api/source.json', JSON.stringify({ repo: 'lennd/sessionboard-public-api-docs', commit, guides: guideTitles }, null, 2) + '\n');

// ---------------------------------------------------------------- write / check
const toBuf = (d) => (Buffer.isBuffer(d) ? d : Buffer.from(d));
const existingOwned = [];
for (const dir of OWNED_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else existingOwned.push(path.relative(ROOT, p));
    }
  })(abs);
}
const stale = existingOwned.filter((rel) => !outputs.has(rel));
const changed = [...outputs].filter(([rel, data]) => {
  const abs = path.join(ROOT, rel);
  return !fs.existsSync(abs) || !fs.readFileSync(abs).equals(toBuf(data));
}).map(([rel]) => rel);

if (unresolved.length) {
  console.error(`api-docs-sync: ${unresolved.length} link(s) could not be mapped:`);
  for (const u of unresolved) console.error('  ' + u);
  process.exit(1);
}

if (CHECK) {
  if (changed.length || stale.length) {
    console.error(`API docs are out of date with ${FROM}${REF ? `@${REF}` : ''}:`);
    for (const c of changed) console.error('  changed ' + c);
    for (const s of stale) console.error('  stale   ' + s);
    console.error('Run: npm run api:sync');
    process.exit(1);
  }
  console.log(`API docs match the source (${commit?.slice(0, 7) ?? 'working tree'}).`);
  process.exit(0);
}

for (const rel of stale) fs.rmSync(path.join(ROOT, rel));
for (const [rel, data] of outputs) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, toBuf(data));
}
console.log(
  `api-docs-sync: ${guidePages.length} guides, ${listOperations(spec).length} endpoints, ${images.size} images from ${commit?.slice(0, 7) ?? 'working tree'}; ${changed.length} file(s) changed, ${stale.length} removed.`,
);
