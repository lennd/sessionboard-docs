import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { headScript, normalizePath, scopeCss, scopePaths } from '../src/lib/help-scope.mjs';

const config = JSON.parse(readFileSync(new URL('../src/data/help-scopes.json', import.meta.url), 'utf8'));

test('normalizePath strips .html, index, trailing slash, query and hash', () => {
  assert.equal(normalizePath('/marketing/advocacy.html#x'), '/marketing/advocacy');
  assert.equal(normalizePath('/marketing/advocacy/?q=1'), '/marketing/advocacy');
  assert.equal(normalizePath('https://learn.sessionboard.com/get-started'), '/get-started');
  assert.equal(normalizePath('/index.html'), '/');
  assert.equal(normalizePath('/'), '/');
});

test('scopePaths groups tagged articles by product and ignores unknown keys', () => {
  const paths = scopePaths(
    [
      { id: 'marketing/advocacy', data: { products: ['marketing'] } },
      { id: 'marketing/media-library', data: { products: ['marketing', 'learning'] } },
      { id: 'sessions/agenda', data: { products: [] } },
      { id: 'x/y', data: { products: ['nope'] } },
    ],
    config,
  );
  assert.deepEqual(paths.marketing, ['/marketing/advocacy', '/marketing/media-library']);
  assert.deepEqual(paths.learning, ['/marketing/media-library']);
});

/** Runs the head script against a fake document/location and returns what it did. */
function run({ search = '', pathname = '/marketing/advocacy', cookie = '' } = {}) {
  const attrs = {};
  const jar = { value: cookie };
  const replaced = [];
  const state = { url: `https://learn.sessionboard.com${pathname}${search}` };
  const document = {
    get cookie() {
      return jar.value;
    },
    set cookie(v) {
      jar.set = v;
    },
    documentElement: { setAttribute: (k, v) => (attrs[k] = v) },
  };
  const location = {
    get href() {
      return state.url;
    },
    search,
    pathname,
    protocol: 'https:',
    replace: (to) => replaced.push(to),
  };
  const history = { state: null, replaceState: (_s, _t, to) => (state.url = `https://learn.sessionboard.com${to}`) };
  const window = {};
  const code = headScript(config, { marketing: ['/marketing/advocacy'], learning: [] });
  new Function('document', 'location', 'history', 'window', 'URLSearchParams', 'URL', code)(
    document,
    location,
    history,
    window,
    URLSearchParams,
    URL,
  );
  return { attrs, setCookie: jar.set, replaced, url: state.url, window };
}

test('?via=marketing sets the scope, the cookie, and cleans the address bar', () => {
  const r = run({ search: '?via=marketing' });
  assert.equal(r.attrs['data-sb-scope'], 'marketing');
  assert.match(r.setCookie, /^sb_help_scope=marketing; path=\/; SameSite=Lax; Secure$/);
  assert.equal(r.url, 'https://learn.sessionboard.com/marketing/advocacy');
  assert.equal(r.window.sbHelpScope.scope, 'marketing');
});

test('a scoped arrival on the home page goes to the scope home', () => {
  assert.deepEqual(run({ search: '?via=learning', pathname: '/' }).replaced, ['/get-started/learning']);
  // Coming back to / later in the visit (cookie only) stays on /.
  assert.deepEqual(run({ pathname: '/', cookie: 'sb_help_scope=learning' }).replaced, []);
});

test('the cookie keeps the scope for the visit', () => {
  const r = run({ cookie: 'a=1; sb_help_scope=learning' });
  assert.equal(r.attrs['data-sb-scope'], 'learning');
  assert.equal(r.setCookie, undefined);
});

test('?via=all (or any unknown value) clears the scope', () => {
  const r = run({ search: '?via=all', cookie: 'sb_help_scope=marketing' });
  assert.equal(r.attrs['data-sb-scope'], undefined);
  assert.match(r.setCookie, /Max-Age=0/);
  assert.equal(r.window.sbHelpScope.scope, null);
});

test('no via and no cookie leaves the page untouched', () => {
  const r = run();
  assert.deepEqual(r.attrs, {});
  assert.equal(r.setCookie, undefined);
  assert.deepEqual(r.replaced, []);
});

test('scopeCss only hides anything under html[data-sb-scope] or for scope homes', () => {
  const css = scopeCss(config);
  for (const line of css.split('\n')) {
    assert.ok(
      line.startsWith('html[data-sb-scope') || line.startsWith('html:not([data-sb-scope])') || line.startsWith('.sb-scope-bar{'),
      line,
    );
  }
  assert.match(css, /li\[data-products\]:not\(\[data-products~='marketing'\]\)/);
});
