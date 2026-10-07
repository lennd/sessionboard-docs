import test from 'node:test';
import assert from 'node:assert/strict';

import { draftFor, labelFor } from '../src/lib/community-draft.mjs';

const base = 'https://learn.example.com';
const entry = (over) => ({
  id: 'require-secure-links-on-url-fields',
  title: 'Require secure links on URL fields',
  summary: 'A **URL field** can save every `http://` link as `https://`.',
  article: '/faq/how-to-create-and-delete-custom-fields#url',
  kind: 'new',
  module: 'Settings',
  availability: 'everyone',
  enable: { how: 'setting', path: 'Field settings → Require secure links' },
  where: { scope: 'both', path: 'Custom fields → URL field' },
  use_case: 'Pasted http:// links break on HTTPS-only sites.',
  internal: {
    cs_action: { kind: 'reach_out', note: 'SECRET-NOTE mention Acme Corp' },
    talk_track: 'SECRET-TALK-TRACK',
    gotchas: ['SECRET-GOTCHA'],
    staff_path: 'Admin → SECRET-STAFF-PATH',
    who_should_get_it: 'SECRET-WHO',
    when_to_bring_up: 'SECRET-WHEN',
  },
  ...over,
});

test('a draft carries the customer-facing facts and the idempotency label', () => {
  const d = draftFor(entry(), base);
  assert.equal(d.title, 'Require secure links on URL fields');
  assert.deepEqual(d.types, ['new']);
  assert.deepEqual(d.labels, ['release:require-secure-links-on-url-fields', 'Settings']);
  assert.match(d.detailsMarkdown, /A URL field can save every http:\/\/ link as https:\/\//);
  assert.match(d.detailsMarkdown, /\*\*Why you'd use it\*\* — Pasted/);
  assert.match(d.detailsMarkdown, /\*\*Who gets it\*\* — Everyone\./);
  assert.match(d.detailsMarkdown, /\*\*How to turn it on\*\* — Field settings → Require secure links\./);
  assert.match(d.detailsMarkdown, /\[Read the guide\]\(https:\/\/learn\.example\.com\/faq\/how-to-create-and-delete-custom-fields#url\)/);
});

test('nothing from internal.* reaches the draft', () => {
  const d = draftFor(entry(), base);
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /SECRET-/);
  assert.doesNotMatch(text, /Acme Corp/);
  assert.doesNotMatch(text, /reach_out|talk_track|staff_path/);
});

test('gated availability is spelled out and default-on needs no path', () => {
  const gated = draftFor(entry({ availability: 'on_request', enable: { how: 'support', path: null } }), base);
  assert.match(gated.detailsMarkdown, /\*\*Who gets it\*\* — On request \(support enables it for your organization or event\)\./);
  assert.match(gated.detailsMarkdown, /\*\*How to turn it on\*\* — Ask support to enable it\./);
  const on = draftFor(entry({ enable: { how: 'default_on', path: null } }), base);
  assert.match(on.detailsMarkdown, /nothing to turn on/);
});

test('the label survives Community\u2019s 80-character limit', () => {
  const long = 'x'.repeat(120);
  assert.equal(labelFor({ id: long }).length, 80);
});
