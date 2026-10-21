/**
 * Drafts the ledger says exist but no branch carries any more.
 *
 * The rolling review branch (release-intake/drafts) is rebuilt every run from
 * main + the drafts on the old branch. When its PR is closed unmerged and the
 * branch deleted, the old branch is gone, the rebuild carries nothing over,
 * and every PR the ledger marked `drafted` has no entry anywhere — while the
 * bot skips it forever because it is "already drafted". That is how the 63
 * drafts on sessionboard-docs#34 vanished on 2026-10-20.
 *
 * GitHub keeps `refs/pull/<n>/head` after a PR closes and its branch is
 * deleted, so the drafts are recoverable from the PR the ledger names. What is
 * not recoverable goes back to `pending` so the next triage drafts it again.
 * To reject a draft for good, set its ledger record to `skip` with a reason —
 * closing the drafts PR is not a rejection.
 *
 * Pure functions; scripts/release-intake.mjs (--recover-drafts) does the git
 * and file work.
 */

/** PR number of a draft PR URL (…/pull/34), or null. */
export function draftPrNumber(url) {
  const m = /\/pull\/(\d+)\/?$/.exec(url || '');
  return m ? Number(m[1]) : null;
}

/**
 * Ledger records `drafted` whose PR no entry names — neither on main nor among
 * the drafts being carried onto the rebuilt branch.
 *
 * @param {object} ledger      parsed _intake.json
 * @param {Set<string>} named  canonical refs (owner/repo#n) some entry names
 * @returns {{ ref: string, draftPr: number|null, entryId: string|null }[]}
 */
export function orphanedDrafts(ledger, named) {
  const out = [];
  for (const [ref, rec] of Object.entries(ledger.prs || {})) {
    if (rec.decision !== 'drafted' || named.has(ref)) continue;
    out.push({ ref, draftPr: draftPrNumber(rec.draft_pr), entryId: rec.entry_id || null });
  }
  return out;
}

/**
 * Pick, from drafts found on old review-PR heads, the ones that name an
 * orphaned ref. Each entry id is taken once (an api/ui pair shares one draft).
 *
 * @param {{ ref: string }[]} orphans
 * @param {{ date: string, entry: object }[]} candidates
 * @param {(raw: string) => string|null} canonical  raw shipped.prs item → canonical ref
 * @returns {{ drafts: { date: string, entry: object }[], refs: string[], lost: typeof orphans }}
 */
export function pickRecovered(orphans, candidates, canonical) {
  const want = new Set(orphans.map((o) => o.ref));
  const found = new Set();
  const ids = new Set();
  const drafts = [];
  for (const c of candidates) {
    const hits = (c.entry.shipped?.prs || []).map(canonical).filter((r) => r && want.has(r));
    if (!hits.length) continue;
    for (const r of hits) found.add(r);
    if (ids.has(c.entry.id)) continue;
    ids.add(c.entry.id);
    drafts.push({ ...c });
  }
  // An api/ui pair drafted under one id: the second draft replaced the first,
  // so the surviving entry names only one of them. Give it back the other.
  for (const o of orphans) {
    if (found.has(o.ref) || !o.entryId) continue;
    const d = drafts.find((x) => x.entry.id === o.entryId);
    if (!d) continue;
    d.entry = { ...d.entry, shipped: { ...d.entry.shipped, prs: [...(d.entry.shipped?.prs || []), o.ref] } };
    found.add(o.ref);
  }
  return { drafts, refs: [...found], lost: orphans.filter((o) => !found.has(o.ref)) };
}

/**
 * Lost drafts go back to `pending` so the next --pending triage re-drafts
 * them. A record whose entry_id is already on main is left alone and reported:
 * a reviewer merged that draft but re-attributed shipped.prs, so re-drafting
 * would duplicate it — add the PR to that entry instead.
 *
 * @returns {{ requeued: string[], stale: { ref: string, entryId: string }[] }}
 */
export function requeueLost(ledger, lost, onMainIds, today) {
  const requeued = [];
  const stale = [];
  for (const o of lost) {
    if (o.entryId && onMainIds.has(o.entryId)) {
      stale.push({ ref: o.ref, entryId: o.entryId });
      continue;
    }
    const rec = ledger.prs[o.ref];
    rec.decision = 'pending';
    rec.requeued = `${today}: draft lost${rec.draft_pr ? ` with ${rec.draft_pr}` : ''}`;
    delete rec.draft_pr;
    delete rec.entry_id;
    delete rec.decided_by;
    requeued.push(o.ref);
  }
  return { requeued, stale };
}
