/**
 * The Academy tab (learn.sessionboard.com/academy).
 *
 * The Academy is Sessionboard's own Learning Site — our LMS, dogfooded — in our
 * own org, filled from sessionboard-tam `academy/` (content as code). This Help
 * Center does not hold lessons. It shows:
 *
 * - the catalog, built in from `src/data/academy/catalog.json` (written by
 *   `npm run academy:catalog` in sessionboard-tam/academy): every learning path
 *   by product and role, with its courses, lessons and final exam;
 * - the reader's progress and certificates, read at runtime through the
 *   Worker (GET /_account/academy → web-api GET /help/academy);
 * - a Start / Continue button that asks the Worker for a one-minute sign-in
 *   link (POST /_account/academy/sign-in) and sends the reader straight into
 *   the lesson on the Learning Site — no second sign-in.
 *
 * Articles that an Academy lesson teaches get a "Learn this in Academy" card
 * (src/components/AcademyLink.astro), found from the Help Center links in the
 * lessons' read steps.
 *
 * Products follow the docs suites (.cursor/rules/product-docs-suites.mdc): a
 * reader sees the paths of the products they hold (`products` from
 * /_account/me), Platform when that is unknown; staff see every path.
 */

/**
 * Is the Academy open (site.json `academy.open`)? While it is not, the header shows no
 * Academy tab, articles show no "Learn this in Academy" card, and /academy is built but
 * kept out of search, Ask's index, the sitemap and llms.txt, and noindexed — reachable
 * only by its address, for staff to preview.
 */
export const academyOpen = (site) => site?.academy?.open === true;
export const ACADEMY_SLUG = 'academy';

export const PRODUCTS = ['platform', 'marketing', 'learning', 'awards'];
export const PRODUCT_LABELS = { platform: 'Platform', marketing: 'Marketing', learning: 'Learning', awards: 'Awards' };
export const ROLE_LABELS = { admin: 'Admin', reviewer: 'Reviewer', 'speaker-manager': 'Speaker manager' };

// `/a/b`, `/a/b/`, and the build's `/a/b.html` (or `/a/index.html`) are one page.
const norm = (path) =>
  `/${String(path || '')
    .replace(/(?:\/index)?\.html$/, '')
    .replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

/** Every lesson in a path: its courses' lessons, then the path's own (the final exam). */
export function lessonsOf(item) {
  if (!item) return [];
  if (item.kind === 'lesson') return [item];
  return [...(item.courses || []).flatMap((c) => c.lessons || []), ...(item.lessons || [])];
}

/** The Academy lessons that teach the article at `pathname`, once each, with the path they sit in. */
export function lessonsForArticle(catalog, pathname) {
  const here = norm(pathname);
  const seen = new Set();
  const out = [];
  for (const item of catalog?.items || []) {
    for (const lesson of lessonsOf(item)) {
      if (seen.has(lesson.key) || !(lesson.help || []).some((h) => norm(h) === here)) continue;
      seen.add(lesson.key);
      out.push({ ...lesson, path: item.key, pathTitle: item.title, product: item.product, released: item.released });
    }
  }
  return out;
}

/** The products whose paths a reader sees: staff all, else what they hold, else Platform. */
export function visibleProducts(reader) {
  if (reader?.staff === true) return [...PRODUCTS];
  const held = Array.isArray(reader?.products) ? reader.products : null;
  if (!held || held.length === 0) return ['platform'];
  return PRODUCTS.filter((p) => held.includes(p));
}

/** `role:<role>` from a path's tags. */
export function roleOf(item) {
  const tag = (item?.tags || []).find((t) => t.startsWith('role:'));
  return tag ? tag.slice(5) : null;
}

/** Paths grouped by product, in suite order. */
export function groupByProduct(items) {
  return PRODUCTS.map((product) => ({ product, items: (items || []).filter((i) => i.product === product) })).filter(
    (g) => g.items.length > 0,
  );
}

/**
 * Where Start / Continue lands on the Learning Site for a path the API returned
 * (with ids): its next lesson, else the path's own page.
 */
export function nextPathFor(live) {
  if (!live) return '/';
  if (live.next_lesson_id) return `/lessons/${live.next_lesson_id}`;
  if (live.kind === 'certification') return `/certifications/${live.id}`;
  if (live.kind === 'series') return `/courses/${live.id}`;
  if (live.kind === 'lesson') return `/lessons/${live.id}`;
  return '/';
}

/** "Add to LinkedIn" for an earned certificate (LinkedIn's add-to-profile URL). */
export function linkedInAddUrl({ name, organizationName = 'Sessionboard', issued, expires, certUrl, certId }) {
  const q = new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name, organizationName });
  const at = (d, k) => {
    const date = d ? new Date(d) : null;
    if (date && !Number.isNaN(date.getTime())) {
      q.set(`${k}Year`, String(date.getUTCFullYear()));
      q.set(`${k}Month`, String(date.getUTCMonth() + 1));
    }
  };
  at(issued, 'issue');
  at(expires, 'expiration');
  if (certUrl) q.set('certUrl', certUrl);
  if (certId) q.set('certId', certId);
  return `https://www.linkedin.com/profile/add?${q.toString()}`;
}
