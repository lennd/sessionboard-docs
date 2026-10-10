#!/usr/bin/env node
/**
 * Send the morning product-updates digest by email.
 *
 * The email twin of release-slack.mjs, kept deliberately short: an intro,
 * one button to the Enablement page, and the five updates CS should know
 * first (topForEmail). The detail lives on the page. Slack posts at the end of the day;
 * this sends the next morning so the team reads it with coffee. Each channel
 * keeps its own marker — Slack writes `shipped.announced_at`, this writes
 * `shipped.emailed_at` — so each recaps exactly what went live since its own
 * previous send and never repeats itself. Same rule as Slack: only entries
 * that are live in production (US + EU); staged work is never mentioned.
 *
 * Sent through SendGrid from josh@sessionboard.com (a verified sender).
 * Recipients come from RELEASE_DIGEST_TO (comma-separated; all-team@sessionboard.com).
 *
 *   SENDGRID_API_KEY=… RELEASE_DIGEST_TO=all-team@sessionboard.com node scripts/release-email.mjs
 *   node scripts/release-email.mjs --dry-run                 # print the text version, send nothing, write nothing
 *   node scripts/release-email.mjs --since 2026-10-01        # dry-run preview of a range
 *   node scripts/release-email.mjs --dry-run --out /tmp/digest.html   # also write the HTML to open in a browser
 *   node scripts/release-email.mjs --test --since 2026-10-07           # really send a "[Test]" digest of that range; marks nothing
 *   node scripts/release-email.mjs --now --since 2026-10-07            # really send, no [Test] prefix, marks nothing
 */

import { writeFileSync } from 'node:fs';

import { lastSentFor, markSent, pendingFor, topForEmail } from '../src/lib/release-digest.mjs';
import { formatDate, internalPrefix, loadReleaseNotes, readSite } from '../src/lib/release-notes.mjs';

const TEST = process.argv.includes('--test');
const NOW = process.argv.includes('--now');
const DRY = process.argv.includes('--dry-run') || (process.argv.includes('--since') && !TEST && !NOW);
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const SINCE = arg('--since');
const OUT = arg('--out');

const API_KEY = process.env.SENDGRID_API_KEY;
const TO = (process.env.RELEASE_DIGEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const FROM = { email: 'josh@sessionboard.com', name: 'Josh Parolin' };
const REPLY_TO = { email: 'josh@sessionboard.com', name: 'Josh Parolin' };

const site = readSite();
const base = `https://${site.canonicalHost}`;
const prefix = internalPrefix(site);

const { releases, problems } = loadReleaseNotes();
if (problems.length) {
  console.error(`\n✖ release notes invalid:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const pending = pendingFor(releases, 'email', { since: SINCE });
if (pending.length === 0) {
  console.log('✓ Nothing new in production since the last email.');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const lastSent = lastSentFor(releases, 'email');
const n = pending.length;
const noun = n === 1 ? 'update' : 'updates';
const headline = `[SB Internal] Release Notes — ${formatDate(today)} (${n} ${noun})`;
const subject = `${TEST ? '[Test] ' : ''}${headline}`;
const enablementHome = `${base}${prefix}`;
const releaseNotesUrl = `${base}/help/release-notes`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const entryUrl = (e) => `${enablementHome}#${encodeURIComponent(e.id)}`;
const liveUrl = `${enablementHome}#live`;
const CS_SHORT = { must_enable: 'CS must enable', can_disable: 'CS can disable', review_before_customers_see: 'Review with customer', reach_out: 'Reach out' };
const csShort = (e) => CS_SHORT[e.internal?.cs_action?.kind] || null;

// The email is a teaser: a short intro, one button and the handful of
// updates CS has to act on first. The full story for every update lives on
// the Enablement page, which is where the button and every row point.
const top = topForEmail(pending, 5);
const lede = `${n} ${noun} went live for every organization${SINCE || lastSent ? ` since ${formatDate(SINCE || lastSent)}` : ''}.${top.length < n ? ` Here ${top.length === 1 ? 'is the one' : `are ${top.length}`} to know first.` : ''}`;

// ---------- HTML ----------

const FONT = 'Helvetica,Arial,sans-serif';
const rowHtml = (e, last) => {
  const cs = csShort(e);
  return `<tr><td style="padding:14px 0;${last ? '' : 'border-bottom:1px solid #eceef2;'}font-family:${FONT}">
  <a href="${entryUrl(e)}" style="color:#14192b;text-decoration:none;font-size:16px;font-weight:600;line-height:1.4">${esc(e.title)}</a>
  <div style="font-size:13px;color:#8a8d98;margin-top:2px">${esc(e.module || 'Platform')}${cs ? ` &nbsp;·&nbsp; <span style="color:#b25e00">${esc(cs)}</span>` : ''}</div>
</td></tr>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:32px 12px;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #eceef2;border-radius:14px;overflow:hidden">
<tr><td style="padding:0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef7c3;border-bottom:1px solid #f0d48a">
    <tr><td style="padding:12px 28px;font:13px/1.5 ${FONT};color:#713f12">
      <strong style="letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:#a16207">SB Internal — staff only</strong>
      <span style="color:#ca8a04"> &nbsp;·&nbsp; </span><a href="${enablementHome}" style="color:#854d0e;font-weight:700">Enablement notes</a>
      <span style="color:#ca8a04"> &nbsp;·&nbsp; </span><a href="${releaseNotesUrl}" style="color:#854d0e;font-weight:700">Release notes (customers)</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:36px 40px 8px;font-family:${FONT}">
  <div style="font-size:13px;font-weight:500;color:#8a8d98;margin:0 0 10px">Release notes · ${esc(formatDate(today))}</div>
  <h1 style="margin:0 0 14px;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-.02em;color:#14192b">See what’s live in the product</h1>
  <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#5b5e6b">${esc(lede)}</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#233dff;border-radius:10px">
    <a href="${liveUrl}" style="display:inline-block;padding:14px 24px;color:#fff;text-decoration:none;font-weight:600;font-size:15px;font-family:${FONT}">Open the release notes</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:32px 40px 0;font-family:${FONT}">
  <div style="border-top:1px solid #eceef2;padding-top:20px;font-size:13px;font-weight:500;color:#8a8d98">Live now</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${top.map((e, i) => rowHtml(e, i === top.length - 1)).join('')}</table>
  <a href="${liveUrl}" style="display:inline-block;margin:14px 0 36px;font-size:15px;font-weight:500;color:#233dff;text-decoration:none">See all ${n} live ${noun} →</a>
</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="padding:20px 8px 0;font:13px/1.6 ${FONT};color:#8a8d98">
  Internal, staff only. Updates not in production yet are at the bottom of the page — don’t mention those to customers.<br>
  For customers, share the <a href="${releaseNotesUrl}" style="color:#8a8d98">public release notes</a>.
</td></tr></table>
</td></tr></table></body></html>`;

// ---------- plain text ----------

const text = [
  headline,
  'SB INTERNAL — staff only',
  '',
  'See what’s live in the product',
  lede,
  '',
  `Open the release notes: ${liveUrl}`,
  '',
  'LIVE NOW',
  ...top.map((e) => {
    const cs = csShort(e);
    return `* ${e.title} (${e.module || 'Platform'}${cs ? ` · ${cs}` : ''})\n  ${entryUrl(e)}`;
  }),
  '',
  `See all ${n} live ${noun}: ${liveUrl}`,
  '',
  'Updates not in production yet are at the bottom of the page — don’t mention those to customers.',
  `For customers, share the public release notes: ${releaseNotesUrl}`,
].join('\n');

if (OUT) {
  writeFileSync(OUT, html);
  console.log(`wrote ${OUT}`);
}

if (DRY) {
  console.log(`Subject: ${subject}\n`);
  console.log(text);
  console.log(`\n(dry run) ${n} entries; nothing sent or written.`);
  process.exit(0);
}

if (!API_KEY) {
  console.error('\n✖ SENDGRID_API_KEY is not set.\n');
  process.exit(1);
}
if (TO.length === 0) {
  console.error('\n✖ RELEASE_DIGEST_TO is not set (comma-separated addresses).\n');
  process.exit(1);
}

const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    personalizations: [{ to: TO.map((email) => ({ email })) }],
    from: FROM,
    reply_to: REPLY_TO,
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
    categories: ['product-updates-digest'],
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
  }),
});
if (!res.ok) {
  console.error(`\n✖ SendGrid returned ${res.status}: ${(await res.text()).slice(0, 300)}\n`);
  process.exit(1);
}

if (TEST || NOW) {
  console.log(`✓ ${TEST ? 'Test email' : 'Email'} with ${n} update(s) sent to ${TO.join(', ')}; nothing marked.`);
  process.exit(0);
}
const touched = markSent(pending, 'email', today);
console.log(`✓ Emailed ${n} update(s) to ${TO.join(', ')}; marked emailed in ${touched} file(s).`);
