import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { faqPageNode } from '../src/lib/faq-schema.mjs';

function page(rel) {
  const raw = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const body = raw.slice(front[0].length);
  const title = front[1].match(/^title:\s*"([^"]+)"/m)[1];
  const description = (front[1].match(/^description:\s*"([^"]+)"/m) || [])[1] || '';
  const slug = rel.replace(/^src\/content\/docs\//, '').replace(/\.mdx$/, '');
  return faqPageNode({
    slug,
    title,
    description,
    body,
    canonical: `https://learn.sessionboard.com/${slug}`,
  });
}

function questions(node) {
  return node.mainEntity.map((q) => q.name);
}

test('a single-question FAQ uses the title and the opening paragraph', () => {
  const node = page('src/content/docs/faq/does-sessionboard-offer-conditional-logic.mdx');
  assert.equal(node['@type'], 'FAQPage');
  assert.ok(questions(node).includes('Does Sessionboard offer conditional logic?'));
  const answer = node.mainEntity[0].acceptedAnswer.text;
  assert.match(answer, /question rules/);
  assert.doesNotMatch(answer, /\[|\]\(|\*\*|<[A-Za-z]/);
  assert.equal(node.mainEntity[0].acceptedAnswer['@type'], 'Answer');
});

test('heading questions and accordion questions are included', () => {
  const share = page('src/content/docs/faq/how-do-i-share-my-submission-form.mdx');
  const names = questions(share);
  assert.ok(names.includes('Can I embed the form on my website?'));
  assert.ok(names.includes('Can I set an open date?'));
  const embed = share.mainEntity.find((q) => q.name.startsWith('Can I embed'));
  assert.match(embed.acceptedAnswer.text, /^No\./);

  const portal = page('src/content/docs/faq/common-speaker-portal-issues-and-how-to-fix-them.mdx');
  assert.ok(questions(portal).some((name) => /wrong one/.test(name)));
});

test('the FAQ hub still emits one FAQPage entity, and other sections do not', () => {
  const hub = page('src/content/docs/faq/overview.mdx');
  assert.equal(hub['@type'], 'FAQPage');
  assert.ok(hub.mainEntity.length >= 1);
  assert.equal(hub.mainEntity[0].name, 'FAQ & troubleshooting');

  assert.equal(
    faqPageNode({
      slug: 'sessions/create-a-session',
      title: 'Create a session',
      description: 'How to create a session.',
      body: 'Create a session from the Sessions page.',
      canonical: 'https://learn.sessionboard.com/sessions/create-a-session',
    }),
    null,
  );
});

test('FAQ answers and the publisher stay Sessionboard', () => {
  const head = readFileSync(new URL('../src/components/Head.astro', import.meta.url), 'utf8');
  assert.match(head, /name: 'Sessionboard'/);
  assert.doesNotMatch(head, /LENND/);
  const node = page('src/content/docs/faq/is-sessionboard-down.mdx');
  assert.doesNotMatch(JSON.stringify(node), /LENND/);
  assert.match(node.mainEntity[0].acceptedAnswer.text, /status\.sessionboard\.com/);
});
