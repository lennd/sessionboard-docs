#!/usr/bin/env node
/**
 * Emits dist/_internal/help-index.json — the machine-readable form of the Help
 * Center that web-api embeds into pgvector for Team Lead retrieval and serves
 * back to the in-app reader.
 *
 * Run after `astro build`, because it reads the BUILT HTML rather than the MDX.
 * That matters: taking Astro's rendered output means Starlight components —
 * Steps, Tabs, Asides, Accordions — survive into the in-app reader. Shipping raw
 * MDX and re-rendering it with a markdown component in React would silently drop
 * every one of them, and those components carry the actual instructions.
 *
 * MDX stays the single source of truth. This file is derived and disposable:
 * every article carries a `contentHash` so the sync job re-embeds only what
 * changed, and dropping the Postgres tables entirely just means the next run
 * rebuilds them.
 *
 * Chunking is by heading section, so every chunk keeps its heading path and
 * yields a deep link (/sessions/create-a-session#add-speakers) rather than
 * sending the reader to the top of a long page.
 *
 * Usage:
 *   npm run build && node scripts/build-help-index.mjs
 *   node scripts/build-help-index.mjs --check   # verify freshness, write nothing
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { absolutizeAssets } from '../src/lib/absolutize-assets.mjs';
import { annotateImages, imageSize } from '../src/lib/annotate-images.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'src', 'content', 'docs');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(DIST, '_internal');
const OUT = join(OUT_DIR, 'help-index.json');

const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const breadcrumbs = JSON.parse(readFileSync(join(ROOT, 'src', 'breadcrumbs.json'), 'utf8'));
const markerSpec = JSON.parse(
  readFileSync(join(ROOT, 'tests', 'fixtures', 'marker-hydration.json'), 'utf8'),
).specVersion;

const CHECK_ONLY = process.argv.includes('--check');

/** Shape of this artifact. web-api refuses an index version it does not know. */
const INDEX_VERSION = 1;

/** Pages that are not articles. */
const EXCLUDE = new Set(['404']);

// Chunk sizing mirrors the transcript corpus (lib/jobs/corpus-embed.js), which
// is tuned for the same embedding model.
const MAX_CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 200;
/**
 * Below this, a chunk cannot carry meaning on its own — "Tip", "Step 1", a
 * card-grid link label, the tail of a hard split. Embedded as-is it becomes a
 * near-random vector that can outrank a real answer, so these are folded into a
 * neighbour rather than kept or discarded.
 */
const SLIVER_CHARS = 40;

// ── frontmatter ────────────────────────────────────────────────────────────

/**
 * Minimal frontmatter reader.
 *
 * Only reads the handful of scalar and inline-array fields this index needs,
 * which is why it can skip a YAML dependency. Nested keys (`sidebar:`) are
 * stepped over rather than parsed.
 */
function readFrontmatter(source) {
  const lines = source.split('\n');
  if (lines[0] !== '---') return {};
  const end = lines.indexOf('---', 1);
  if (end === -1) return {};

  const out = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue; // nested entry or continuation
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (!value) continue; // a nested block like `sidebar:`
    if (value.startsWith('[')) {
      out[key] = value
        .slice(1, value.lastIndexOf(']'))
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

// ── HTML extraction ────────────────────────────────────────────────────────

/**
 * Slice the inner HTML of the element carrying `class="sl-markdown-content"`.
 *
 * Matches the opening TAG, not the bare class name: the string
 * "sl-markdown-content" also appears earlier in every page, inside the
 * speakable JSON-LD block's cssSelector, and anchoring there extracts the
 * page's structured data instead of its article.
 *
 * Depth-counted rather than regex-matched from there: the article body is full
 * of nested divs, and a greedy or lazy regex would end at the wrong `</div>`.
 * Astro's output is well-formed and divs are never self-closing, so counting is
 * exact.
 */
const CONTENT_TAG_RE =
  /<([a-zA-Z][\w-]*)[^>]*\sclass="[^"]*\bsl-markdown-content\b[^"]*"[^>]*>/;

function extractArticleHtml(html) {
  const open = CONTENT_TAG_RE.exec(html);
  if (!open) return null;

  const tagName = open[1];
  const openStart = open.index;
  const openEnd = openStart + open[0].length - 1;

  const openRe = new RegExp(`<${tagName}\\b`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  let depth = 1;
  let cursor = openEnd + 1;
  const bodyStart = cursor;

  while (depth > 0 && cursor < html.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(bodyStart, nextClose.index);
    cursor = nextClose.index + nextClose[0].length;
  }
  return null;
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

/** Rendered HTML → the plain text that gets embedded. */
function toText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    // Starlight puts a visually-hidden "Section titled “…”" span inside every
    // heading anchor. It is invisible to readers but would otherwise prefix a
    // third of the corpus, diluting those chunks' embeddings with boilerplate.
    .replace(/<span\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    // `</td>` and `</th>` break to a newline too: a wide table row is otherwise
    // one unbroken line with nowhere to split a chunk.
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ── chunking ───────────────────────────────────────────────────────────────

/**
 * Split article HTML into heading-scoped sections.
 *
 * Starlight gives every heading an `id`, which becomes the chunk's anchor — so
 * a retrieved chunk deep-links to the exact step rather than the page top.
 */
function splitSections(html, title) {
  const headingRe = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const sections = [];
  let lastIndex = 0;
  let current = { level: 1, anchor: null, heading: title };

  let match;
  while ((match = headingRe.exec(html)) !== null) {
    sections.push({ ...current, html: html.slice(lastIndex, match.index) });
    const [, level, attrs, inner] = match;
    current = {
      level: Number(level),
      anchor: /id="([^"]+)"/.exec(attrs)?.[1] ?? null,
      heading: toText(inner),
    };
    lastIndex = match.index + match[0].length;
  }
  sections.push({ ...current, html: html.slice(lastIndex) });

  return sections;
}

/**
 * Sections → embeddable chunks.
 *
 * Small sections merge into their predecessor and oversized ones split on
 * paragraph boundaries, so a chunk is never a two-word sliver nor a wall of
 * text that dilutes its own embedding.
 */
function buildChunks(sections, title) {
  const chunks = [];

  const push = (section, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const headingPath =
      section.level === 1 || section.heading === title
        ? [title]
        : [title, section.heading].filter(Boolean);

    // Last-resort bound. Paragraph splitting handles prose, but a single
    // unbroken run — one enormous table cell, a pasted block — has no boundary
    // to split on, and an oversized chunk both dilutes its embedding and risks
    // the model's input limit. Break on whitespace so words stay intact.
    let rest = trimmed;
    while (rest.length > MAX_CHUNK_CHARS) {
      const window = rest.slice(0, MAX_CHUNK_CHARS);
      const cut = window.lastIndexOf(' ') > MIN_CHUNK_CHARS ? window.lastIndexOf(' ') : MAX_CHUNK_CHARS;
      chunks.push({ anchor: section.anchor, headingPath, text: rest.slice(0, cut).trim() });
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push({ anchor: section.anchor, headingPath, text: rest });
  };

  for (const section of sections) {
    const text = toText(section.html);
    if (!text) continue;

    if (text.length <= MAX_CHUNK_CHARS) {
      const previous = chunks[chunks.length - 1];
      // Merge a sliver forward only when it belongs to the same heading, so a
      // heading's own anchor is never lost to its neighbour.
      if (
        previous &&
        text.length < MIN_CHUNK_CHARS &&
        previous.anchor === section.anchor &&
        previous.text.length + text.length <= MAX_CHUNK_CHARS
      ) {
        previous.text += `\n${text}`;
        continue;
      }
      push(section, text);
      continue;
    }

    let buffer = '';
    for (const paragraph of text.split('\n')) {
      if (buffer && buffer.length + paragraph.length + 1 > MAX_CHUNK_CHARS) {
        push(section, buffer);
        buffer = '';
      }
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
    }
    push(section, buffer);
  }

  return coalesceSlivers(chunks);
}

/**
 * Fold sub-meaningful chunks into an adjacent one, keeping the neighbour's
 * anchor. An article that is nothing but a sliver keeps it — one weak chunk
 * beats being unfindable.
 */
function coalesceSlivers(chunks) {
  if (chunks.length <= 1) return chunks;

  const out = [];
  for (const chunk of chunks) {
    const previous = out[out.length - 1];
    if (
      chunk.text.length < SLIVER_CHARS &&
      previous &&
      previous.text.length + chunk.text.length <= MAX_CHUNK_CHARS
    ) {
      previous.text += `\n${chunk.text}`;
      continue;
    }
    out.push(chunk);
  }

  // A sliver in first position has no predecessor to merge into, so it merges
  // forward instead.
  if (out.length > 1 && out[0].text.length < SLIVER_CHARS) {
    const [first, second, ...rest] = out;
    if (first.text.length + second.text.length <= MAX_CHUNK_CHARS) {
      return [{ ...second, text: `${first.text}\n${second.text}` }, ...rest];
    }
  }

  return out;
}

// ── walk ───────────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.mdx')) out.push(full);
  }
  return out;
}

const canonical = (slug, anchor) =>
  `https://${site.canonicalHost}${slug}${anchor ? `#${anchor}` : ''}`;

/**
 * Intrinsic size of an image the build already produced, memoized because the
 * same screenshot appears in several articles and the corpus has 1,200 of them.
 */
const sizeCache = new Map();
const localImageSize = (src) => {
  const path = src.startsWith(`https://${site.canonicalHost}/`)
    ? src.slice(`https://${site.canonicalHost}`.length)
    : src;
  if (!path.startsWith('/')) return null; // hosted elsewhere; nothing to measure

  const file = join(DIST, decodeURIComponent(path.split('?')[0]).slice(1));
  if (sizeCache.has(file)) return sizeCache.get(file);

  let size = null;
  try {
    size = imageSize(readFileSync(file));
  } catch {
    // A missing file is check-images.mjs's job to report, not this script's.
  }
  sizeCache.set(file, size);
  return size;
};

if (!existsSync(DIST)) {
  console.error('\n✖ No dist/ — run `npm run build` before building the help index.\n');
  process.exit(1);
}

const articles = [];
const problems = [];

for (const file of walk(DOCS).sort()) {
  const rel = relative(DOCS, file).replace(/\.mdx$/, '');
  if (EXCLUDE.has(rel)) continue;

  const slug = rel === 'index' ? '/' : `/${rel}`;
  const htmlPath = join(DIST, rel === 'index' ? 'index.html' : `${rel}.html`);
  if (!existsSync(htmlPath)) {
    problems.push(`${rel}: no built page at ${relative(ROOT, htmlPath)}`);
    continue;
  }

  const front = readFrontmatter(readFileSync(file, 'utf8'));
  const extracted = extractArticleHtml(readFileSync(htmlPath, 'utf8'));
  const bodyHtml =
    extracted &&
    annotateImages(
      absolutizeAssets(extracted, site.canonicalHost),
      localImageSize,
    );
  if (!bodyHtml) {
    problems.push(`${rel}: could not find sl-markdown-content in the built page`);
    continue;
  }

  const title = front.title ?? rel;
  let chunks = buildChunks(splitSections(bodyHtml, title), title);

  // The video walkthroughs are a single embed with no prose, so they yield no
  // text to embed. Synthesising a chunk from the title and description keeps
  // them retrievable — "is there a video about importing data?" should find one
  // — rather than dropping 30 articles out of the index.
  if (chunks.length === 0) {
    const fallback = [title, front.description].filter(Boolean).join('. ');
    if (!fallback) {
      problems.push(`${rel}: no text and no description — nothing to index`);
      continue;
    }
    chunks = [{ anchor: null, headingPath: [title], text: fallback }];
  }

  chunks = chunks.map((chunk) => ({
    ...chunk,
    canonicalUrl: canonical(slug, chunk.anchor),
  }));

  // Hash everything a consumer can observe, so any change that would alter a
  // retrieval result or the reader's output invalidates the cached embedding —
  // and nothing else does, keeping steady-state re-embedding near zero.
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        title,
        description: front.description ?? null,
        features: front.features ?? [],
        audience: front.audience ?? ['organizer'],
        jtbd: front.jtbd ?? null,
        bodyHtml,
      }),
    )
    .digest('hex');

  articles.push({
    slug,
    canonicalUrl: canonical(slug),
    title,
    description: front.description ?? null,
    section: breadcrumbs[rel]?.section ?? null,
    features: front.features ?? [],
    audience: front.audience ?? ['organizer'],
    jtbd: front.jtbd ?? null,
    contentHash,
    bodyHtml,
    chunks,
  });
}

if (problems.length > 0) {
  console.error(
    '\n✖ Could not index every article:\n' +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\n',
  );
  process.exit(1);
}

const index = {
  indexVersion: INDEX_VERSION,
  // Which marker vocabulary the embedded bodyHtml uses. The reader refuses to
  // hydrate an index built for a spec it does not implement.
  markerSpecVersion: markerSpec,
  canonicalHost: site.canonicalHost,
  builtAt: new Date().toISOString(),
  articleCount: articles.length,
  chunkCount: articles.reduce((n, a) => n + a.chunks.length, 0),
  articles,
};

if (CHECK_ONLY) {
  console.log(
    `✓ ${index.articleCount} articles, ${index.chunkCount} chunks indexable ` +
      `(marker spec v${markerSpec}).`,
  );
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(index));

const bytes = statSync(OUT).size;
console.log(
  `Wrote ${relative(ROOT, OUT)}\n` +
    `  ${index.articleCount} articles, ${index.chunkCount} chunks, ` +
    `${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
