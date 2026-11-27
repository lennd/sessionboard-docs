import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { articlesToKnowledgeBase } from '../src/lib/legacy-articles.mjs';

test('Intercom /en/articles/<slug> becomes the HubSpot knowledge-base path', () => {
  assert.equal(articlesToKnowledgeBase('/en/articles/bizzabo-integration'), '/en/knowledge-base/bizzabo-integration');
  assert.equal(articlesToKnowledgeBase('/en/articles/bizzabo-integration/'), '/en/knowledge-base/bizzabo-integration');
  assert.equal(articlesToKnowledgeBase('/en/articles/foo%20bar'), '/en/knowledge-base/foo bar');
});

test('an articles index with no slug maps to the knowledge-base index', () => {
  assert.equal(articlesToKnowledgeBase('/en/articles'), '/en/knowledge-base');
  assert.equal(articlesToKnowledgeBase('/en/articles/'), '/en/knowledge-base');
});

test('ordinary paths are not rewritten, so a legacy host can preserve them', () => {
  assert.equal(articlesToKnowledgeBase('/get-started/overview'), null);
  assert.equal(articlesToKnowledgeBase('/en/knowledge-base/bizzabo-integration'), null);
  assert.equal(articlesToKnowledgeBase('/faq/overview'), null);
  assert.equal(articlesToKnowledgeBase('/'), null);
});

test('the Worker resolves articles through that rewrite and 301s sitemap.xml to the index', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /articlesToKnowledgeBase\(url\.pathname\)/);
  assert.match(worker, /pathname === '\/sitemap\.xml'/);
  assert.match(worker, /sitemap-index\.xml/);
  assert.doesNotMatch(worker, /ASSETS\.fetch\(new Request\(`\$\{url\.origin\}\/sitemap-index\.xml`/);
});
