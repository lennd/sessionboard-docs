import test from 'node:test';
import assert from 'node:assert/strict';

import { demoHrefFor, docsCampaignSlug } from '../src/lib/demo-cta.mjs';

test('homepage campaign is home, never empty', () => {
  for (const id of ['', 'index', '/', null, undefined]) {
    assert.equal(docsCampaignSlug(id), 'home');
  }
  const href = demoHrefFor('');
  assert.equal(
    href,
    'https://www.sessionboard.com/demo/?utm_source=help-center&utm_medium=docs&utm_campaign=home&utm_content=footer-cta&sb_growth_page=home&sb_growth_type=docs',
  );
});

test('article slugs keep the existing dash convention and the demo path', () => {
  assert.equal(docsCampaignSlug('faq/is-sessionboard-down'), 'faq-is-sessionboard-down');
  const href = demoHrefFor('get-started/overview');
  assert.match(href, /^https:\/\/www\.sessionboard\.com\/demo\/\?/);
  assert.doesNotMatch(href, /\/contact/);
  assert.match(href, /utm_source=help-center/);
  assert.match(href, /utm_medium=docs/);
  assert.match(href, /utm_campaign=get-started-overview/);
  assert.match(href, /utm_content=footer-cta/);
  assert.match(href, /sb_growth_page=get-started-overview/);
  assert.match(href, /sb_growth_type=docs/);
});
