import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';

import {
  PLATFORM,
  anySelfServeBuilt,
  availableSuites,
  builtSuites,
  crossSuiteLinks,
  internalLinks,
  keepEntry,
  keepResult,
  landingTarget,
  resolveSidebar,
  sidebarSlugs,
  suiteForId,
  suiteForPath,
  suiteHeadScript,
} from '../src/lib/suites.mjs';

const root = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, 'src/data/suites.json'), 'utf8'));
const ALL = builtSuites(config, { SB_PREVIEW_SUITES: '1' });
const NONE = builtSuites(config, {});

test('production builds only Platform until a suite is released', () => {
  for (const key of Object.keys(config.suites)) {
    if (key !== PLATFORM) assert.equal(config.suites[key].released, false, `${key} is unreleased on this branch`);
  }
  assert.deepEqual([...NONE], [PLATFORM]);
  assert.equal(anySelfServeBuilt(NONE), false);
  assert.deepEqual([...ALL].sort(), ['awards', 'learning', 'marketing', 'platform']);
  assert.deepEqual([...builtSuites(config, { SB_PREVIEW_SUITES: 'learning' })].sort(), ['learning', 'platform']);
  assert.ok(builtSuites({ suites: { ...config.suites, awards: { ...config.suites.awards, released: true } } }, {}).has('awards'));
});

test('a path belongs to a suite only under its own prefix; everything else is Platform', () => {
  assert.equal(suiteForPath('/sessionboard-marketing/get-started', config), 'marketing');
  assert.equal(suiteForPath('/sessionboard-marketing', config), 'marketing');
  assert.equal(suiteForPath('https://learn.sessionboard.com/sessionboard-learning/courses/create-a-course.html', config), 'learning');
  assert.equal(suiteForPath('/sessionboard-awards/', config), 'awards');
  // Platform folders with product-like names stay Platform.
  assert.equal(suiteForPath('/marketing/advocacy', config), PLATFORM);
  assert.equal(suiteForPath('/awards/getting-started', config), PLATFORM);
  assert.equal(suiteForPath('/get-started/marketing', config), PLATFORM);
  assert.equal(suiteForPath('/sessionboard-marketingx/a', config), PLATFORM);
  assert.equal(suiteForId('index', config), PLATFORM);
  assert.equal(suiteForId('sessionboard-awards/programs/open-nominations', config), 'awards');
});

test('the content loader drops unbuilt suites and never a Platform page', () => {
  assert.equal(keepEntry('marketing/advocacy', config, NONE), true);
  assert.equal(keepEntry('sessionboard-marketing/get-started', config, NONE), false);
  assert.equal(keepEntry('sessionboard-marketing/get-started', config, ALL), true);
});

test('landing: ?via= goes to a built suite home; platform/all and unbuilt suites stay put', () => {
  assert.equal(landingTarget({ path: '/', via: 'marketing' }, config, ALL), '/sessionboard-marketing/get-started');
  assert.equal(landingTarget({ path: '/get-started/marketing', via: 'marketing' }, config, ALL), '/sessionboard-marketing/get-started');
  assert.equal(landingTarget({ path: '/sessionboard-marketing/campaigns', via: 'marketing' }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', via: 'platform' }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', via: 'all' }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', via: 'marketing' }, config, NONE), null);
});

test('landing: the remembered suite and the token decide only on the site root', () => {
  assert.equal(landingTarget({ path: '/', remembered: 'awards' }, config, ALL), '/sessionboard-awards/get-started');
  assert.equal(landingTarget({ path: '/sessions/agenda', remembered: 'awards' }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', products: ['learning'] }, config, ALL), '/sessionboard-learning/get-started');
  // Platform plus a self-serve product, or two self-serve products: stay on Platform, switcher shown.
  assert.equal(landingTarget({ path: '/', products: ['platform', 'learning'] }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', products: ['marketing', 'learning'] }, config, ALL), null);
  // Unknown products (signed out, older API) default to Platform.
  assert.equal(landingTarget({ path: '/', products: null }, config, ALL), null);
  assert.equal(landingTarget({ path: '/', products: ['learning'] }, config, NONE), null);
});

test('the switcher lists only the suites the token holds and the build has', () => {
  assert.deepEqual(availableSuites(['awards', 'platform'], config, ALL), ['platform', 'awards']);
  assert.deepEqual(availableSuites(['awards', 'platform'], config, NONE), ['platform']);
  assert.deepEqual(availableSuites(null, config, ALL), []);
});

test('search keeps results inside the reader’s suite in both directions', () => {
  assert.equal(keepResult('/sessionboard-marketing/people/import', 'marketing', config), true);
  assert.equal(keepResult('/marketing/advocacy', 'marketing', config), false);
  assert.equal(keepResult('/sessionboard-learning/courses', 'marketing', config), false);
  assert.equal(keepResult('/marketing/advocacy', PLATFORM, config), true);
  assert.equal(keepResult('/sessionboard-marketing/get-started', PLATFORM, config), false);
});

test('resolveSidebar builds Starlight entries and refuses unknown slugs', () => {
  const entries = [
    { id: 'sessionboard-awards/get-started', data: { title: 'Get started with Sessionboard Awards', sidebar: { label: 'Get started' } } },
    { id: 'sessionboard-awards/review/invite-reviewers', data: { title: 'Invite reviewers' } },
  ];
  const tree = resolveSidebar(
    [{ slug: 'sessionboard-awards/get-started' }, { label: 'Review', items: [{ slug: 'sessionboard-awards/review/invite-reviewers' }] }],
    { entries, currentPath: '/sessionboard-awards/review/invite-reviewers' },
  );
  assert.deepEqual(tree[0], { type: 'link', label: 'Get started', href: '/sessionboard-awards/get-started', isCurrent: false, badge: undefined, attrs: {} });
  assert.equal(tree[1].type, 'group');
  assert.equal(tree[1].entries[0].isCurrent, true);
  assert.throws(() => resolveSidebar([{ slug: 'sessionboard-awards/nope' }], { entries, currentPath: '/' }), /not a page/);
});

test('internal link extraction ignores assets, anchors and externals', () => {
  const src = '[a](/sessionboard-awards/x#y) [b](https://x.com/a) ![c](/images/kb/a.png) <a href="/marketing/advocacy">x</a> [d](#here)';
  assert.deepEqual(internalLinks(src), ['/sessionboard-awards/x', '/marketing/advocacy']);
});

test('crossSuiteLinks flags any link across a suite boundary', () => {
  const problems = crossSuiteLinks(
    [
      { id: 'sessionboard-awards/a', source: '[ok](/sessionboard-awards/b) [bad](/awards/getting-started)' },
      { id: 'sessions/agenda', source: '[bad](/sessionboard-learning/get-started) [ok](/sessions/x)' },
    ],
    config,
  );
  assert.deepEqual(
    problems.map((p) => `${p.id} -> ${p.href}`),
    ['sessionboard-awards/a -> /awards/getting-started', 'sessions/agenda -> /sessionboard-learning/get-started'],
  );
});

// ── The head script, run as the browser runs it ────────────────────────────

function runHead({ path, search = '', cookie = '' }) {
  const replaced = [];
  const attrs = {};
  const doc = {
    cookie,
    documentElement: { setAttribute: (k, v) => (attrs[k] = v) },
  };
  const cookies = [];
  Object.defineProperty(doc, 'cookie', { get: () => cookie, set: (v) => cookies.push(v) });
  const window = {};
  const location = { pathname: path, search, protocol: 'https:', replace: (u) => replaced.push(u) };
  vm.runInNewContext(suiteHeadScript(config, ALL), { document: doc, location, window, URLSearchParams });
  return { replaced, attrs, cookies, state: window.sbSuites };
}

test('head script: ?via=learning remembers the suite and goes to its home', () => {
  const r = runHead({ path: '/', search: '?via=learning' });
  assert.deepEqual(r.replaced, ['/sessionboard-learning/get-started']);
  assert.match(r.cookies[0], /^sb_help_suite=learning; path=\/; SameSite=Lax; Secure$/);
});

test('head script: a suite page stamps its suite and does not move', () => {
  const r = runHead({ path: '/sessionboard-awards/review/invite-reviewers.html', cookie: 'sb_help_suite=awards' });
  assert.deepEqual(r.replaced, []);
  assert.equal(r.attrs['data-sb-suite'], 'awards');
  assert.equal(r.state.here, 'awards');
});

test('head script: remembered suite only redirects the root; ?via=platform clears it', () => {
  assert.deepEqual(runHead({ path: '/', cookie: 'sb_help_suite=marketing' }).replaced, ['/sessionboard-marketing/get-started']);
  assert.deepEqual(runHead({ path: '/sessions/agenda', cookie: 'sb_help_suite=marketing' }).replaced, []);
  const cleared = runHead({ path: '/', search: '?via=platform', cookie: 'sb_help_suite=marketing' });
  assert.deepEqual(cleared.replaced, []);
  assert.match(cleared.cookies[0], /Max-Age=0/);
  assert.equal(cleared.attrs['data-sb-suite'], PLATFORM);
});

// ── The suites on disk ─────────────────────────────────────────────────────

const docsDir = join(root, 'src/content/docs');
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.mdx?$/.test(name) ? [full] : [];
  });
}
const pages = walk(docsDir).map((file) => ({
  id: relative(docsDir, file).replace(/\.mdx?$/, '').replace(/\/index$/, ''),
  source: readFileSync(file, 'utf8'),
}));

test('no page links across a suite boundary', () => {
  assert.deepEqual(crossSuiteLinks(pages, config), []);
});

test('each suite sidebar lists every page of its suite and nothing else', () => {
  for (const [key, suite] of Object.entries(config.suites)) {
    if (key === PLATFORM) continue;
    const listed = sidebarSlugs(JSON.parse(readFileSync(join(root, `src/data/suites/${suite.sidebar}.sidebar.json`), 'utf8')));
    const onDisk = pages.filter((p) => suiteForId(p.id, config) === key).map((p) => p.id);
    assert.deepEqual([...listed].sort(), [...onDisk].sort(), `${key} sidebar vs ${suite.path}`);
    assert.ok(onDisk.includes(suite.home.slice(1)), `${key} home ${suite.home} exists`);
  }
});

test('Platform sidebar never lists a suite page', () => {
  const platform = sidebarSlugs(JSON.parse(readFileSync(join(root, 'src/sidebar.json'), 'utf8')));
  assert.deepEqual(platform.filter((slug) => suiteForId(slug, config) !== PLATFORM), []);
});
