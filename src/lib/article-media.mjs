/**
 * The media an article already carries — training chapters, walkthrough clips
 * and screenshots — in the order a gallery should show them: videos first,
 * then the screenshots from the section the link points at, then the rest.
 *
 * Nothing here is curated. A release entry's gallery is whatever its `article`
 * shows, so a screenshot added to the guide appears in the release notes, the
 * Enablement card and the in-article <Gallery /> without a second list.
 *
 * Reads MDX source directly (like videosForArticle), so it runs at build time
 * only and the output is plain data the MediaGallery component serializes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_DIR, videosForArticle } from './release-notes.mjs';

// ![alt](src "title")  — the title is rarely used; keep it as a fallback caption.
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"([^"]*)")?\s*\)/g;
const HTML_IMG_RE = /<img\b([^>]*)>/gi;
const HEADING_RE = /^(#{2,4})\s+(.+?)\s*#*\s*$/gm;
const FENCE_RE = /```[\s\S]*?```/g;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2]) : null;
}

/** Same slugger GitHub/Starlight use for heading ids, close enough for anchors. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function stripFences(src) {
  return src.replace(FENCE_RE, '');
}

/** Split MDX into [{ id, text }] by h2–h4; the preamble gets id ''. */
function sections(src) {
  const out = [];
  let last = 0;
  let id = '';
  for (const m of src.matchAll(HEADING_RE)) {
    out.push({ id, text: src.slice(last, m.index) });
    id = slugify(m[2]);
    last = m.index;
  }
  out.push({ id, text: src.slice(last) });
  return out;
}

function imagesIn(text) {
  const out = [];
  for (const m of text.matchAll(MD_IMAGE_RE)) {
    const src = m[2].replace(/^<|>$/g, '');
    if (!IMAGE_EXT.test(src)) continue;
    out.push({ type: 'image', src, alt: m[1] || m[3] || '' });
  }
  for (const m of text.matchAll(HTML_IMG_RE)) {
    const src = attr(m[1], 'src');
    if (!src || !IMAGE_EXT.test(src)) continue;
    out.push({ type: 'image', src, alt: attr(m[1], 'alt') || '' });
  }
  return out;
}

/**
 * Media for an article path such as `/settings/domains#verify-the-records`.
 * Returns [] for a missing article so callers never branch on existence.
 */
export function mediaForArticle(path) {
  const raw = String(path || '');
  const anchor = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : '';
  const clean = raw.replace(/#.*$/, '').replace(/^\//, '');
  const file = join(DOCS_DIR, `${clean}.mdx`);
  if (!clean || !existsSync(file)) return [];

  const source = stripFences(readFileSync(file, 'utf8'));

  const videos = videosForArticle(path).map((v) => ({
    type: 'video',
    src: v.src,
    poster: v.poster || null,
    title: v.title || '',
    start: v.start || 0,
    kind: v.kind,
    anchor: v.anchor,
  }));

  const secs = sections(source);
  const seen = new Set();
  const pick = (list) => list.filter((img) => (seen.has(img.src) ? false : (seen.add(img.src), true)));

  let first = [];
  if (anchor) {
    const hit = secs.find((s) => s.id === anchor);
    if (hit) first = pick(imagesIn(hit.text));
  }
  const rest = pick(secs.flatMap((s) => imagesIn(s.text)));

  return [...videos, ...first, ...rest];
}

/** The one item a thumbnail shows: the first video's poster, else the first image. */
export function thumbnailFor(media) {
  const v = media.find((m) => m.type === 'video' && m.poster);
  if (v) return { src: v.poster, alt: v.title, isVideo: true };
  const i = media.find((m) => m.type === 'image');
  if (i) return { src: i.src, alt: i.alt, isVideo: false };
  const anyVideo = media.find((m) => m.type === 'video');
  if (anyVideo) return { src: null, alt: anyVideo.title, isVideo: true };
  return null;
}
