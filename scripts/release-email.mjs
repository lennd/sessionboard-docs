#!/usr/bin/env node
/**
 * Send the morning product-updates digest by email.
 *
 * The email twin of release-slack.mjs. Slack posts at the end of the day;
 * this sends the next morning so the team reads it with coffee. Each channel
 * keeps its own marker — Slack writes `shipped.announced_at`, this writes
 * `shipped.emailed_at` — so each recaps exactly what went live since its own
 * previous send and never repeats itself. Same rule as Slack: only entries
 * that are live in production (US + EU); staged work is never mentioned.
 *
 * Sent through SendGrid from no-reply@sessionboard.com (a verified sender on
 * the account). Recipients come from RELEASE_DIGEST_TO (comma-separated).
 *
 *   SENDGRID_API_KEY=… RELEASE_DIGEST_TO=josh@sessionboard.com node scripts/release-email.mjs
 *   node scripts/release-email.mjs --dry-run                 # print the text version, send nothing, write nothing
 *   node scripts/release-email.mjs --since 2026-10-01        # dry-run preview of a range
 *   node scripts/release-email.mjs --dry-run --out /tmp/digest.html   # also write the HTML to open in a browser
 */

import { writeFileSync } from 'node:fs';

import { mediaForEntry, thumbnailFor } from '../src/lib/article-media.mjs';
import { byModule, csText, enableText, lastSentFor, markSent, pendingFor, shortSummary, whoText } from '../src/lib/release-digest.mjs';
import { formatDate, internalPrefix, loadReleaseNotes, readSite } from '../src/lib/release-notes.mjs';

const DRY = process.argv.includes('--dry-run') || process.argv.includes('--since');
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const SINCE = arg('--since');
const OUT = arg('--out');

const API_KEY = process.env.SENDGRID_API_KEY;
const TO = (process.env.RELEASE_DIGEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const FROM = { email: 'no-reply@sessionboard.com', name: 'Sessionboard Product Updates' };
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
const subject = `Now in production — ${formatDate(today)} (${n} ${noun})`;
const sinceLine = lastSent ? `Everything that went live since the last digest on ${formatDate(lastSent)}.` : 'Everything that is live in production right now.';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const abs = (p) => (p && /^https?:/.test(p) ? p : `${base}${p}`);
const enablementUrl = (e) => `${base}${prefix}/releases/${e.id}`;

// ---------- HTML ----------

const CS_COLOR = { must_enable: '#b42318', can_disable: '#b54708', review_before_customers_see: '#175cd3', reach_out: '#027a48' };

const thumbCell = (e) => {
  const t = thumbnailFor(mediaForEntry(e));
  if (!t || !t.src) return '';
  const badge = t.isVideo ? '<div style="position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;font:600 11px/1 Helvetica,Arial,sans-serif;padding:4px 6px;border-radius:4px">▶ Video</div>' : '';
  return `<td width="140" valign="top" style="padding:0 16px 0 0"><a href="${enablementUrl(e)}" style="display:block;position:relative;text-decoration:none"><img src="${abs(t.src)}" alt="${esc(t.alt)}" width="140" style="display:block;width:140px;height:92px;object-fit:cover;border-radius:6px;border:1px solid #e4e7ec">${badge}</a></td>`;
};

const cardHtml = (e) => {
  const cs = csText(e);
  const links = [`<a href="${enablementUrl(e)}" style="color:#175cd3">Enablement notes</a>`];
  if (e.article) links.push(`<a href="${base}${e.article}" style="color:#175cd3">Guide</a>`);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px"><tr>
${thumbCell(e)}
<td valign="top" style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#101828">
  <div style="font-size:16px;font-weight:700;line-height:1.3;margin:0 0 4px"><a href="${enablementUrl(e)}" style="color:#101828;text-decoration:none">${esc(e.title)}</a></div>
  <div style="color:#667085;font-size:12px;margin:0 0 6px">${esc(e.module || 'Platform')}${e.kind ? ` · ${esc(e.kind)}` : ''}</div>
  <div style="margin:0 0 8px">${esc(shortSummary(e, 320))}</div>
  <div style="font-size:13px;color:#344054;margin:0 0 4px"><strong>Who:</strong> ${esc(whoText(e))} &nbsp;·&nbsp; <strong>Turn on:</strong> ${esc(enableText(e))}</div>
  ${cs ? `<div style="font-size:13px;margin:0 0 6px;color:${CS_COLOR[cs.kind] || '#344054'}"><strong>CS:</strong> ${esc(cs.text)}</div>` : ''}
  <div style="font-size:13px">${links.join(' &nbsp;·&nbsp; ')}</div>
</td></tr></table>`;
};

const sectionsHtml = byModule(pending)
  .map(
    ([module, entries]) => `
<h2 style="font:700 13px/1 Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#667085;margin:28px 0 14px;padding-top:18px;border-top:1px solid #eaecf0">${esc(module)} <span style="font-weight:500">· ${entries.length}</span></h2>
${entries.map(cardHtml).join('')}`,
  )
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f9fafb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid #eaecf0;border-radius:10px">
<tr><td style="padding:28px 28px 8px;font-family:Helvetica,Arial,sans-serif">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#667085;font-weight:600">Product updates</div>
  <h1 style="font-size:22px;line-height:1.25;margin:6px 0 8px;color:#101828">Now in production — ${esc(formatDate(today))}</h1>
  <p style="margin:0;font-size:14px;line-height:1.5;color:#344054">${esc(sinceLine)} ${n} ${noun}, live for every organization (US + EU). Full CS notes, videos and who-should-get-it on <a href="${base}${prefix}" style="color:#175cd3">Enablement</a>; the customer-facing list is <a href="${base}/help/release-notes" style="color:#175cd3">Release notes</a>.</p>
</td></tr>
<tr><td style="padding:0 28px 28px">${sectionsHtml}</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #eaecf0;font:12px/1.5 Helvetica,Arial,sans-serif;color:#98a2b3">Sent every weekday morning by the Help Center's release workflow. Slack gets the same digest at the end of the day in #product-development. Source: <a href="https://github.com/lennd/sessionboard-docs" style="color:#98a2b3">lennd/sessionboard-docs</a> · src/data/release-notes.</td></tr>
</table></td></tr></table></body></html>`;

// ---------- plain text ----------

const text = [
  `NOW IN PRODUCTION — ${formatDate(today)} (${n} ${noun})`,
  sinceLine,
  `Enablement: ${base}${prefix}   Release notes: ${base}/help/release-notes`,
  '',
  ...byModule(pending).flatMap(([module, entries]) => [
    `== ${module.toUpperCase()} (${entries.length}) ==`,
    ...entries.flatMap((e) => {
      const cs = csText(e);
      return [
        `* ${e.title}${e.kind ? ` (${e.kind})` : ''}`,
        `  ${shortSummary(e, 320)}`,
        `  Who: ${whoText(e)} · Turn on: ${enableText(e)}`,
        ...(cs ? [`  CS: ${cs.text}`] : []),
        `  ${enablementUrl(e)}${e.article ? `   Guide: ${base}${e.article}` : ''}`,
        '',
      ];
    }),
  ]),
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

const touched = markSent(pending, 'email', today);
console.log(`✓ Emailed ${n} update(s) to ${TO.join(', ')}; marked emailed in ${touched} file(s).`);
