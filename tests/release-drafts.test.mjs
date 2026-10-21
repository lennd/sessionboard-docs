import { test } from 'node:test';
import assert from 'node:assert/strict';

import { draftPrNumber, orphanedDrafts, pickRecovered, requeueLost, supersededOnMain } from '../src/lib/release-drafts.mjs';

const DOCS = 'https://github.com/lennd/sessionboard-docs/pull';
const canonical = (raw) => (/^lennd\/[a-z0-9-]+#\d+$/.test(raw) ? raw : null);
const draft = (id, prs, date = '2026-10-19') => ({ date, entry: { id, shipped: { prs } } });

// The 2026-10-20 failure: #34 closed unmerged, branch deleted, rebuild carried nothing.
function ledger() {
  return {
    prs: {
      'lennd/sessionboard-web-api#4566': { decision: 'drafted', draft_pr: `${DOCS}/34`, entry_id: 'attend-app-contact-exchange' },
      'lennd/sessionboard-web-api#4573': { decision: 'drafted', draft_pr: `${DOCS}/34`, entry_id: 'signin-groups' },
      'lennd/sessionboard-web-ui-v2#1044': { decision: 'drafted', draft_pr: `${DOCS}/34`, entry_id: 'signin-groups' },
      'lennd/sessionboard-web-api#4518': { decision: 'drafted', draft_pr: `${DOCS}/29`, entry_id: 'attend-mobile-app-early-access' },
      'lennd/sessionboard-web-api#4999': { decision: 'drafted', draft_pr: `${DOCS}/34`, entry_id: 'gone' },
      'lennd/sessionboard-web-api#4637': { decision: 'drafted', draft_pr: `${DOCS}/39`, entry_id: 'on-current-branch' },
      'lennd/sessionboard-web-api#4600': { decision: 'entry', entry_id: 'on-main' },
      'lennd/sessionboard-web-api#4626': { decision: 'skip', reason: 'test only' },
    },
  };
}

test('reads the PR number from a draft PR url', () => {
  assert.equal(draftPrNumber(`${DOCS}/34`), 34);
  assert.equal(draftPrNumber(null), null);
});

test('a drafted PR is orphaned only when neither main nor the carried drafts name it', () => {
  const named = new Set(['lennd/sessionboard-web-api#4637', 'lennd/sessionboard-web-api#4600']);
  const refs = orphanedDrafts(ledger(), named).map((o) => o.ref);
  assert.deepEqual(refs.sort(), [
    'lennd/sessionboard-web-api#4518',
    'lennd/sessionboard-web-api#4566',
    'lennd/sessionboard-web-api#4573',
    'lennd/sessionboard-web-api#4999',
    'lennd/sessionboard-web-ui-v2#1044',
  ]);
});

test('recovers drafts from the closed PR head, re-attaches a pair that shared an id, and re-queues the rest', () => {
  const l = ledger();
  const orphans = orphanedDrafts(l, new Set(['lennd/sessionboard-web-api#4637']));
  const head34 = [
    draft('attend-app-contact-exchange', ['lennd/sessionboard-web-api#4566']),
    draft('signin-groups', ['lennd/sessionboard-web-ui-v2#1044']), // the api half's draft was replaced by this one
    draft('unrelated-draft', ['lennd/sessionboard-web-api#1']),
  ];
  const { drafts, refs, lost } = pickRecovered(orphans, head34, canonical);

  assert.deepEqual(drafts.map((d) => d.entry.id), ['attend-app-contact-exchange', 'signin-groups']);
  assert.deepEqual(drafts[1].entry.shipped.prs, ['lennd/sessionboard-web-ui-v2#1044', 'lennd/sessionboard-web-api#4573']);
  assert.equal(head34[1].entry.shipped.prs.length, 1, 'input drafts are not mutated');
  assert.equal(refs.length, 3);
  assert.deepEqual(lost.map((o) => o.ref).sort(), ['lennd/sessionboard-web-api#4518', 'lennd/sessionboard-web-api#4999']);

  const { requeued, stale } = requeueLost(l, lost, new Set(['attend-mobile-app-early-access']), '2026-10-21');
  assert.deepEqual(requeued, ['lennd/sessionboard-web-api#4999']);
  assert.equal(l.prs['lennd/sessionboard-web-api#4999'].decision, 'pending');
  assert.equal(l.prs['lennd/sessionboard-web-api#4999'].draft_pr, undefined);
  assert.match(l.prs['lennd/sessionboard-web-api#4999'].requeued, /draft lost with .*\/pull\/34/);
  // Merged draft whose reviewer re-attributed shipped.prs: report, never re-draft a duplicate.
  assert.deepEqual(stale, [{ ref: 'lennd/sessionboard-web-api#4518', entryId: 'attend-mobile-app-early-access' }]);
  assert.equal(l.prs['lennd/sessionboard-web-api#4518'].decision, 'drafted');
  // Untouched: human skips, entries, drafts on the live branch.
  assert.equal(l.prs['lennd/sessionboard-web-api#4626'].decision, 'skip');
  assert.equal(l.prs['lennd/sessionboard-web-api#4637'].decision, 'drafted');
});

test('a draft is superseded only when main names every PR it ships', () => {
  const named = new Set(['lennd/sessionboard-web-api#4547', 'lennd/sessionboard-web-ui-v2#1054']);
  assert.ok(supersededOnMain({ shipped: { prs: ['lennd/sessionboard-web-api#4547'] } }, named, canonical));
  assert.ok(!supersededOnMain({ shipped: { prs: ['lennd/sessionboard-web-api#4547', 'lennd/sessionboard-web-api#9'] } }, named, canonical));
  assert.ok(!supersededOnMain({ shipped: { prs: [] } }, named, canonical));
});
