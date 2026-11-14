/**
 * Cards that link to a restricted page (site.json staffOnly / signedInOnly,
 * src/lib/staff-only.mjs) carry the tier marker worker.js removes for readers
 * who cannot open the page: data-staff-only, or data-signed-in-only.
 *
 * Without it the Worker only unwraps the card's <a>, which leaves a Starlight
 * LinkCard as a dead box and spills a StartTile's icon, title and text into the
 * surrounding grid (the home page's Release notes tile, 2026-11-14).
 *
 * Runs after the build over dist/**\/*.html, because a LinkCard is Starlight's
 * own component and its markup only exists once rendered.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStaffOnlyHref } from './staff-only.mjs';

/** The marker for a link to `href`, or '' when the page is public. */
export function tierAttr(href, site) {
  if (!isStaffOnlyHref(href, site)) return '';
  return isStaffOnlyHref(href, site, 'staff') ? ' data-staff-only' : ' data-signed-in-only';
}

// A Starlight LinkCard: <div class="sl-link-card …"><span …><a href="…">
const LINK_CARD = /<div class="(sl-link-card[^"]*)"([^>]*)>(\s*<span[^>]*>\s*<a\b[^>]*?\bhref=")([^"]+)(")/g;
// Our tiles and cards, where the <a> is the whole card: StartTile (sb-start-tile), compat Card (sb-card).
const ANCHOR_CARD = /<a class="((?:sb-start-tile|sb-card)\b[^"]*)"([^>]*?)\bhref="([^"]+)"/g;

/** One page's HTML with every restricted card marked. */
export function markRestrictedCards(html, site) {
  return html
    .replace(LINK_CARD, (all, cls, rest, mid, href, end) => {
      const attr = /data-(staff|signed-in)-only/.test(rest) ? '' : tierAttr(href, site);
      return attr ? `<div class="${cls}"${rest}${attr}>${mid}${href}${end}` : all;
    })
    .replace(ANCHOR_CARD, (all, cls, rest, href) => {
      const attr = /data-(staff|signed-in)-only/.test(rest) ? '' : tierAttr(href, site);
      return attr ? `<a class="${cls}"${attr}${rest}href="${href}"` : all;
    });
}

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Astro integration: mark restricted cards in every built page. */
export function restrictedCards(site) {
  return {
    name: 'sb-restricted-cards',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        let pages = 0;
        for (const file of htmlFiles(root)) {
          const html = readFileSync(file, 'utf8');
          const marked = markRestrictedCards(html, site);
          if (marked !== html) {
            writeFileSync(file, marked);
            pages += 1;
          }
        }
        if (pages) logger.info(`marked restricted cards on ${pages} page(s)`);
      },
    },
  };
}
