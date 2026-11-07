/**
 * Documentation suites: one per product (src/data/suites.json,
 * .cursor/rules/product-docs-suites.mdc).
 *
 * Platform is every page outside the suite folders and stays exactly as it
 * was. Marketing, Learning and Awards are their own URL trees
 * (`/sessionboard-marketing/…`), each with its own sidebar, search results and
 * Ask grounding, and none of them links outside itself.
 *
 * Which suite a reader sees, first match wins:
 *   1. the page's own path (a suite URL always renders its suite);
 *   2. where help was opened from: `?via=<product>` from the product's Help
 *      button, remembered for the visit in SUITE_COOKIE;
 *   3. the signed-in token: /help/reader/me `products` — someone who holds
 *      exactly one self-serve product and no Platform org lands on that suite;
 *   4. Platform.
 * A reader with several products gets a switcher listing only those.
 *
 * An unreleased suite (`released: false`) is left out of the build unless
 * SB_PREVIEW_SUITES names it (`1` / `all` for every suite). With no
 * self-serve suite built, nothing here changes a byte of the Platform HTML.
 *
 * Plain JS: imported by content.config.ts, Astro components, the build
 * scripts and the tests.
 */

/**
 * `/a/b.html#x?y` → `/a/b`; `/index` → `/`. The same rule as help-scope.mjs
 * `normalizePath`, kept as its own copy on purpose: page scripts import this
 * module, and sharing a module with Sidebar.astro's script would make Vite
 * split both into chunks and change every Platform page's HTML.
 */
export function normalizePath(href) {
  let path = String(href ?? '');
  try {
    path = new URL(path, 'https://x.invalid').pathname;
  } catch {
    return '';
  }
  path = path.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/$/, '');
  return path || '/';
}

export const PLATFORM = 'platform';
export const SUITE_COOKIE = 'sb_help_suite';

/** Self-serve suite keys, in config order. */
export const selfServeKeys = (config) => Object.keys(config.suites).filter((k) => k !== PLATFORM);

/**
 * Keys built into this site: Platform, every released suite, and whatever
 * SB_PREVIEW_SUITES names (`1`/`all`/`true` = every suite, else a comma list).
 */
export function builtSuites(config, env = {}) {
  const preview = String(env.SB_PREVIEW_SUITES ?? '').trim().toLowerCase();
  const all = ['1', 'all', 'true', 'yes'].includes(preview);
  const named = new Set(preview.split(',').map((s) => s.trim()).filter(Boolean));
  return new Set([PLATFORM, ...selfServeKeys(config).filter((k) => config.suites[k].released || all || named.has(k))]);
}

/** True when at least one self-serve suite is in the build. */
export const anySelfServeBuilt = (built) => [...built].some((k) => k !== PLATFORM);

/** The suite a path belongs to: a self-serve suite by its `path` prefix, else Platform. */
export function suiteForPath(href, config) {
  const path = normalizePath(href);
  for (const key of selfServeKeys(config)) {
    const root = config.suites[key].path;
    if (path === root || path.startsWith(`${root}/`)) return key;
  }
  return PLATFORM;
}

/** Docs collection id (`sessionboard-marketing/get-started`) → its suite. */
export const suiteForId = (id, config) => suiteForPath(id === 'index' ? '/' : `/${id}`, config);

/** Content-loader filter: drop entries of suites that are not built. */
export const keepEntry = (id, config, built) => built.has(suiteForId(id, config));

/** The suites a reader can switch between: what their token holds, as built here, Platform first. */
export function availableSuites(products, config, built) {
  const held = new Set(Array.isArray(products) ? products : []);
  return Object.keys(config.suites).filter((k) => held.has(k) && built.has(k));
}

/**
 * Where to send a reader, or null to stay. Pure so the head script, the
 * account script and the tests agree.
 *
 *   via      — `?via=` value (null when absent). A built suite key goes to that
 *              suite's home unless already inside it; `platform`/`all` clears.
 *   remembered — the suite cookie, used only on the site root.
 *   products — the reader token's products (null while unknown), used only on
 *              the site root when nothing else decided.
 */
export function landingTarget({ path, via = null, remembered = null, products = null }, config, built) {
  const here = suiteForPath(path, config);
  const isRoot = normalizePath(path) === '/';
  const homeOf = (key) => (key && key !== PLATFORM && built.has(key) ? config.suites[key].home : null);

  if (via !== null && via !== undefined) {
    const home = homeOf(via);
    return home && here !== via ? home : null;
  }
  if (!isRoot) return null;
  if (remembered) return homeOf(remembered);
  if (Array.isArray(products)) {
    const selfServe = products.filter((p) => p !== PLATFORM && built.has(p));
    if (!products.includes(PLATFORM) && selfServe.length === 1) return homeOf(selfServe[0]);
  }
  return null;
}

/** Search: keep a result only when it belongs to the suite the reader is in. */
export const keepResult = (href, suite, config) => suiteForPath(href, config) === suite;

// ── Sidebar ────────────────────────────────────────────────────────────────

const titleOf = (entry) => entry?.data?.sidebar?.label ?? entry?.data?.title ?? entry?.id;

/**
 * A suite's sidebar config (Starlight's `{ slug }` / `{ label, items }` /
 * `{ label, link }` shape, as in src/sidebar.json) → the SidebarEntry tree
 * Starlight renders, with `isCurrent` set. Unknown slugs throw: a suite
 * sidebar naming a page that does not exist is a broken build, not a quiet gap.
 */
export function resolveSidebar(items, { entries, currentPath }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const current = normalizePath(currentPath);
  const walk = (list) =>
    list.map((item) => {
      if (item.items) {
        return { type: 'group', label: item.label, entries: walk(item.items), collapsed: item.collapsed ?? false, badge: undefined };
      }
      if (item.slug !== undefined) {
        const entry = byId.get(item.slug);
        if (!entry) throw new Error(`Suite sidebar names "${item.slug}", which is not a page.`);
        const href = `/${item.slug}`;
        return { type: 'link', label: item.label ?? titleOf(entry), href, isCurrent: normalizePath(href) === current, badge: undefined, attrs: {} };
      }
      return { type: 'link', label: item.label, href: item.link, isCurrent: normalizePath(item.link) === current, badge: undefined, attrs: {} };
    });
  return walk(items);
}

/** Every slug a sidebar config lists. */
export function sidebarSlugs(items) {
  return items.flatMap((item) => (item.items ? sidebarSlugs(item.items) : item.slug !== undefined ? [item.slug] : []));
}

// ── Cross-suite links ────────────────────────────────────────────────────

/** Internal page links in MDX source: markdown `](/x)` and `href="/x"`. Assets are not pages. */
const LINK_RE = /\]\((\/[^)\s#?]*)[^)]*\)|href=["'{]+(\/[^"'}\s#?]*)/g;
const ASSET_RE = /^\/(images|media|og|_astro|pagefind|fonts|favicon|assets)\b|\.[a-z0-9]{2,5}$/i;

export function internalLinks(source) {
  const out = [];
  for (const m of String(source).matchAll(LINK_RE)) {
    const href = m[1] ?? m[2];
    if (href && !ASSET_RE.test(href)) out.push(href);
  }
  return out;
}

/**
 * Links that cross a suite boundary: a suite page linking anywhere but its
 * own suite, or a Platform page linking into a suite.
 * @param {{id: string, source: string}[]} pages
 * @returns {{id: string, href: string, from: string, to: string}[]}
 */
export function crossSuiteLinks(pages, config) {
  const problems = [];
  for (const page of pages) {
    const from = suiteForId(page.id, config);
    for (const href of internalLinks(page.source)) {
      const to = suiteForPath(href, config);
      if (to !== from) problems.push({ id: page.id, href, from, to });
    }
  }
  return problems;
}

// ── Head script ──────────────────────────────────────────────────────────

/**
 * The inline head script for a site with a self-serve suite built. Runs
 * before Starlight's: reads `?via=`, remembers a suite in SUITE_COOKIE (or
 * clears it on `platform`/`all`), and replaces the location with the suite
 * home landingTarget() picks. The `?via=` itself is left for help-scope's
 * script, which strips it from the address bar.
 */
export function suiteHeadScript(config, built) {
  const suites = Object.fromEntries(
    [...built]
      .filter((k) => k !== PLATFORM)
      .map((k) => [k, { path: config.suites[k].path, home: config.suites[k].home, label: config.suites[k].label }]),
  );
  return `(function(){
var C=${JSON.stringify(SUITE_COOKIE)},S=${JSON.stringify(suites)},d=document,l=location;
var via=null;try{via=new URLSearchParams(l.search).get('via');}catch(e){}
var has=function(k){return Object.prototype.hasOwnProperty.call(S,k);};
var tail='; path=/; SameSite=Lax'+(l.protocol==='https:'?'; Secure':'');
var m=d.cookie.match(new RegExp('(?:^|; )'+C+'=([^;]*)'));var remembered=m?decodeURIComponent(m[1]):null;
if(via!==null){if(has(via)){d.cookie=C+'='+via+tail;}else{d.cookie=C+'='+tail+'; Max-Age=0';remembered=null;}}
var p=l.pathname.replace(/\\/index(\\.html)?$/,'/').replace(/\\.html$/,'');if(p.length>1)p=p.replace(/\\/$/,'');p=p||'/';
var here='platform';for(var k in S){if(has(k)&&(p===S[k].path||p.indexOf(S[k].path+'/')===0))here=k;}
var go=null;
if(via!==null){if(has(via)&&here!==via)go=S[via].home;}
else if(p==='/'&&remembered&&has(remembered))go=S[remembered].home;
d.documentElement.setAttribute('data-sb-suite',here);
window.sbSuites={here:here,suites:S,via:via};
if(go)l.replace(go);
})();`;
}
