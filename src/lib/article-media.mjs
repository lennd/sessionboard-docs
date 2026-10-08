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

/** Split MDX into [{ id, level, text }] by h2–h4; the preamble gets id '' and level 1. */
function sections(src) {
  const out = [];
  let last = 0;
  let id = '';
  let level = 1;
  for (const m of src.matchAll(HEADING_RE)) {
    out.push({ id, level, start: last, text: src.slice(last, m.index) });
    id = slugify(m[2]);
    level = m[1].length;
    last = m.index;
  }
  out.push({ id, level, start: last, text: src.slice(last) });
  return out;
}

/**
 * The anchored section plus its subsections — everything up to the next
 * heading of the same or a higher level. That is "the part of the guide this
 * link is about".
 */
function sectionTree(secs, anchor) {
  const i = secs.findIndex((s) => s.id === anchor);
  if (i < 0) return [];
  const out = [secs[i]];
  for (let j = i + 1; j < secs.length && secs[j].level > secs[i].level; j++) out.push(secs[j]);
  return out;
}

function parseArticlePath(path) {
  const raw = String(path || '');
  const anchor = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : '';
  const clean = raw.replace(/#.*$/, '').replace(/^\//, '');
  const file = join(DOCS_DIR, `${clean}.mdx`);
  return { anchor, clean, file };
}

function videoItems(path, source) {
  return videosForArticle(path).map((v) => ({
    type: 'video',
    src: v.src,
    poster: v.poster || null,
    title: v.title || '',
    start: v.start || 0,
    kind: v.kind,
    anchor: v.anchor,
    duration: v.duration || 0,
    // Where in the source the embed sits, so a section-scoped gallery can
    // keep the chapter that is embedded in that section and drop the others.
    offset: source ? source.indexOf(v.src) : -1,
  }));
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
  const { anchor, clean, file } = parseArticlePath(path);
  if (!clean || !existsSync(file)) return [];

  const source = stripFences(readFileSync(file, 'utf8'));
  const videos = videoItems(path, source).map(({ offset, ...v }) => v);
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

/**
 * Media for ONE release entry — only what is pertinent to that line item,
 * never the whole guide:
 *
 *   1. `entry.media` when the author listed it: image paths (or video URLs)
 *      in display order. Alt text is taken from the article when the image
 *      appears there, else the entry title.
 *   2. Otherwise, when `entry.article` has an anchor, the screenshots and any
 *      chapter embedded in that section (and its subsections).
 *   3. Otherwise nothing. An un-anchored link to a long guide says nothing
 *      about which screenshots show the change, so the card has no thumbnail
 *      until someone adds an anchor or a `media` list.
 */
export function mediaForEntry(entry) {
  const article = entry?.article;
  const { anchor, clean, file } = parseArticlePath(article);
  const exists = Boolean(clean && existsSync(file));
  const source = exists ? stripFences(readFileSync(file, 'utf8')) : '';
  const articleImages = exists ? imagesIn(source) : [];

  if (Array.isArray(entry?.media) && entry.media.length) {
    const videos = exists ? videoItems(article, source) : [];
    return entry.media
      .map((raw) => {
        const item = typeof raw === 'string' ? { src: raw } : raw || {};
        if (!item.src) return null;
        const v = videos.find((x) => x.src === item.src);
        if (v || /\.(mp4|webm|m3u8)(\?.*)?$/i.test(item.src)) {
          return { type: 'video', src: item.src, poster: item.poster ?? v?.poster ?? null, title: item.title ?? v?.title ?? entry.title, start: item.start ?? v?.start ?? 0 };
        }
        const known = articleImages.find((x) => x.src === item.src);
        return { type: 'image', src: item.src, alt: item.alt ?? known?.alt ?? entry.title };
      })
      .filter(Boolean);
  }

  if (!exists || !anchor) return [];
  const tree = sectionTree(sections(source), anchor);
  if (!tree.length) return [];
  const lo = tree[0].start;
  const hi = tree[tree.length - 1].start + tree[tree.length - 1].text.length;
  const videos = videoItems(article, source)
    .filter((v) => v.offset >= lo && v.offset < hi)
    .map(({ offset, ...v }) => v);
  const seen = new Set();
  const images = tree.flatMap((s) => imagesIn(s.text)).filter((i) => (seen.has(i.src) ? false : (seen.add(i.src), true)));
  return [...videos, ...images];
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
