import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PRODUCT_BADGES, productBadgeHtml } from '../src/lib/product-badges.mjs';

const css = readFileSync(new URL('../src/styles/custom.css', import.meta.url), 'utf8');

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** rgb(r g b / a) over a solid background → hex. */
const over = (rgba, page) => {
  const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
  const p = [1, 3, 5].map((i) => parseInt(page.slice(i, i + 2), 16));
  return '#' + [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * p[i]).toString(16).padStart(2, '0')).join('');
};

test('one badge per product, matching sessionboard.com tones', () => {
  assert.deepEqual(Object.keys(PRODUCT_BADGES), ['platform', 'marketing', 'learning', 'awards', 'sessions', 'crm']);
  assert.equal(PRODUCT_BADGES.platform.light.fg, '#1e62d8'); // .t-blue
  assert.equal(PRODUCT_BADGES.marketing.light.fg, '#6d4bd8'); // .t-violet
  assert.equal(PRODUCT_BADGES.learning.light.fg, '#b45309'); // .t-amber
  assert.equal(PRODUCT_BADGES.awards.light.fg, '#be2459'); // .t-rose
});

test('custom.css carries exactly these colors, light and dark', () => {
  for (const [key, b] of Object.entries(PRODUCT_BADGES)) {
    assert.ok(css.includes(`.sb-product-badge[data-product='${key}'] { color: ${b.light.fg}; background: ${b.light.bg}; }`), `${key} light`);
    assert.ok(css.includes(`:root[data-theme='dark'] .sb-product-badge[data-product='${key}'] { color: ${b.dark.fg}; background: ${b.dark.bg}; }`), `${key} dark`);
  }
});

test('icon on badge meets 3:1 (WCAG 1.4.11) in light and dark', () => {
  const darkPage = '#0f1630'; // --sl-color-black, dark theme
  for (const [key, b] of Object.entries(PRODUCT_BADGES)) {
    assert.ok(ratio(b.light.fg, b.light.bg) >= 3, `${key} light ${ratio(b.light.fg, b.light.bg)}`);
    const bg = over(b.dark.bg, darkPage);
    assert.ok(ratio(b.dark.fg, bg) >= 3, `${key} dark ${ratio(b.dark.fg, bg)}`);
  }
});

test('decorative beside a name, labelled when alone', () => {
  assert.match(productBadgeHtml('awards'), /aria-hidden="true"/);
  assert.doesNotMatch(productBadgeHtml('awards'), /role="img"/);
  assert.match(productBadgeHtml('learning', { label: 'Sessionboard Learning' }), /role="img" aria-label="Sessionboard Learning"/);
  assert.equal(productBadgeHtml('nope'), '');
});
