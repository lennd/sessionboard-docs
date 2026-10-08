#!/usr/bin/env node
/**
 * Post the end-of-day product-updates digest to Slack.
 *
 * Picks every entry that is live in production (both main regions) and has not
 * been posted to Slack yet (the morning email keeps its own marker,
 * shipped.emailed_at — see release-email.mjs), posts ONE message with a short card per feature, then
 * writes `shipped.announced_at` so it is never posted twice. Staged entries are
 * never mentioned: a CSM who reads the channel should be able to open any
 * customer's org and find the thing.
 *
 * Each card is deliberately short — what, module, who gets it, how to turn it
 * on, and a CS flag when CS has to do something — and links to the internal
 * enablement page for the full story (why it is valuable, when to bring it up,
 * who should get it, the staff path, videos, gotchas) and to the public guide.
 *
 *   SLACK_PRODUCT_UPDATES_WEBHOOK_URL=… node scripts/release-slack.mjs
 *   node scripts/release-slack.mjs --dry-run      # print the payload, post nothing, write nothing
 *   node scripts/release-slack.mjs --since 2026-10-01   # dry-run preview of what a day's digest looks like
 */

import { formatDate, internalPrefix, loadReleaseNotes, readSite } from '../src/lib/release-notes.mjs';
import { CS_EMOJI, byModule, csText, enableText, markSent, pendingFor, shortSummary, whoText } from '../src/lib/release-digest.mjs';

const DRY = process.argv.includes('--dry-run') || process.argv.includes('--since');
const sinceIdx = process.argv.indexOf('--since');
const SINCE = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : null;
const WEBHOOK = process.env.SLACK_PRODUCT_UPDATES_WEBHOOK_URL;

const site = readSite();
const base = `https://${site.canonicalHost}`;
const prefix = internalPrefix(site);

const { releases, problems } = loadReleaseNotes();
if (problems.length) {
  console.error(`\n✖ release notes invalid:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const pending = pendingFor(releases, 'slack', { since: SINCE });

if (pending.length === 0) {
  console.log('✓ Nothing new in production since the last digest.');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);

const card = (e) => {
  const lines = [
    `*<${base}${prefix}/releases/${e.id}|${e.title}>*  ·  ${e.module || 'Platform'}${e.kind ? ` · ${e.kind}` : ''}`,
    shortSummary(e),
    `• *Who:* ${whoText(e)}   • *Turn on:* ${enableText(e)}`,
  ];
  const cs = csText(e);
  if (cs) lines.push(`• ${CS_EMOJI[cs.kind] || ':information_source:'} *CS:* ${cs.text}`);
  const links = [`<${base}${prefix}/releases/${e.id}|Enablement notes>`];
  if (e.article) links.push(`<${base}${e.article}|Guide>`);
  lines.push(links.join('  ·  '));
  return { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } };
};

// Slack caps a message at 50 blocks; group by module so a big day still reads.
const blocks = [
  {
    type: 'header',
    text: { type: 'plain_text', text: `Now in production — ${formatDate(today)} (${pending.length} ${pending.length === 1 ? 'update' : 'updates'})`, emoji: true },
  },
  {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Everything below is live for every organization (US + EU). Full CS notes, videos and who-should-get-it: <${base}${prefix}|Enablement>. Customer-facing list: <${base}/help/release-notes|Release notes>.`,
      },
    ],
  },
];
for (const [module, entries] of byModule(pending)) {
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${module}*` } });
  for (const e of entries) blocks.push(card(e));
}
if (blocks.length > 50) {
  // Keep the header/context; replace the overflow with a pointer.
  blocks.length = 48;
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `…and more. See <${base}${prefix}|Enablement> for the full list.` } });
}

const payload = { text: `Now in production: ${pending.length} product ${pending.length === 1 ? 'update' : 'updates'}`, blocks };

if (DRY) {
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n(dry run) ${pending.length} entries; nothing posted or written.`);
  process.exit(0);
}

if (!WEBHOOK) {
  console.error('\n✖ SLACK_PRODUCT_UPDATES_WEBHOOK_URL is not set.\n');
  process.exit(1);
}

const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
if (!res.ok) {
  console.error(`\n✖ Slack returned ${res.status}: ${(await res.text()).slice(0, 200)}\n`);
  process.exit(1);
}

const touched = markSent(pending, 'slack', today);
console.log(`✓ Posted ${pending.length} update(s); marked announced in ${touched} file(s).`);
