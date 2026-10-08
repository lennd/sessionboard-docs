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

import { mediaForEntry, thumbnailFor } from '../src/lib/article-media.mjs';
import { byModule, enablementFacts, lastSentFor, markSent, pendingFor, shortSummary } from '../src/lib/release-digest.mjs';
import { CS_ACTION, formatDate, internalPrefix, loadReleaseNotes, readSite } from '../src/lib/release-notes.mjs';

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
const sinceLine = SINCE
  ? `Everything that went live since ${formatDate(SINCE)}.`
  : lastSent
    ? `Everything that went live since the last digest on ${formatDate(lastSent)}.`
    : 'Everything that is live in production right now.';
const enablementHome = `${base}${prefix}`;
const releaseNotesUrl = `${base}/help/release-notes`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const abs = (p) => (p && /^https?:/.test(p) ? p : `${base}${p}`);
const enablementUrl = (e) => `${base}${prefix}/releases/${e.id}`;
const CS_COLOR = { must_enable: '#b42318', can_disable: '#b54708', review_before_customers_see: '#175cd3', reach_out: '#027a48' };

// ---------- HTML ----------


const thumbCell = (e) => {
  const t = thumbnailFor(mediaForEntry(e));
  if (!t || !t.src) return '';
  const badge = t.isVideo ? '<div style="position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;font:600 11px/1 Helvetica,Arial,sans-serif;padding:4px 6px;border-radius:4px">▶ Video</div>' : '';
  return `<td width="140" valign="top" style="padding:0 16px 0 0"><a href="${enablementUrl(e)}" style="display:block;position:relative;text-decoration:none"><img src="${abs(t.src)}" alt="${esc(t.alt)}" width="140" style="display:block;width:140px;height:92px;object-fit:cover;border-radius:6px;border:1px solid #e4e7ec">${badge}</a></td>`;
};

const LABEL = 'font:700 10.5px/1 Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#667085;margin:0 0 5px';
const BOX = 'padding:10px 12px;border:1px solid #eaecf0;border-radius:6px;font:13px/1.5 Helvetica,Arial,sans-serif;color:#344054;vertical-align:top';
const panel = (label, inner, extra = '') => `<td width="50%" style="${BOX}${extra}"><div style="${LABEL}">${label}</div>${inner}</td>`;
const gap = '<td width="8" style="padding:0"></td>';
const row = (cells) => `<tr>${cells.join(gap)}</tr><tr><td colspan="${cells.length * 2 - 1}" style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`;
const muted = (t) => `<div style="color:#667085">${t}</div>`;

const factsHtml = (e) => {
  const f = enablementFacts(e, { base });
  const who = `<strong>${esc(f.who.label)}</strong> — ${esc(f.who.short)}.${f.who.note ? `<div style="margin-top:4px">${esc(f.who.note)}</div>` : ''}${f.who.seen_by.length ? muted(`Seen by: ${esc(f.who.seen_by.join(', '))}`) : ''}`;
  const csInner = f.cs
    ? `<strong style="color:${CS_COLOR[f.cs.kind] || '#344054'}">${esc(f.cs.action)}.</strong>${f.cs.note ? `<div style="margin-top:4px">${esc(f.cs.note)}</div>` : ''}`
    : muted(esc(CS_ACTION.none));
  const turnOn = `<div><strong>Customer:</strong> ${esc(f.turn_on.customer)}</div>${f.turn_on.staff ? `<div style="margin-top:4px"><strong>Staff:</strong> ${esc(f.turn_on.staff)}</div>` : ''}${f.turn_on.flags.length ? muted(`Feature flag${f.turn_on.flags.length > 1 ? 's' : ''}: ${esc(f.turn_on.flags.join(', '))}`) : ''}`;
  const where = f.where.scope || f.where.path ? `${f.where.scope ? `<strong>${esc(f.where.scope)}</strong>` : ''}${f.where.scope && f.where.path ? ' — ' : ''}${esc(f.where.path || '')}` : muted('Not specified');
  const show = [
    f.show.guide ? `<div><a href="${f.show.guide.url}" style="color:#175cd3">${esc(f.show.guide.title)}</a> <span style="color:#667085">— the customer-facing guide</span></div>` : muted('No guide linked'),
    ...f.show.related.map((r) => `<div><a href="${r.url}" style="color:#175cd3">${esc(r.title)}</a></div>`),
    ...f.show.videos.map(
      (v) =>
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>${v.poster ? `<td width="72" style="padding:0 8px 0 0"><a href="${v.url}"><img src="${v.poster}" alt="" width="72" style="display:block;width:72px;height:44px;object-fit:cover;border-radius:4px;border:1px solid #e4e7ec"></a></td>` : ''}<td style="font:13px/1.4 Helvetica,Arial,sans-serif"><a href="${v.url}" style="color:#175cd3">${esc(v.title)}</a><div style="color:#667085;font-size:12px">${esc(v.kind)}${v.duration ? ` · ${v.duration}s` : ''}</div></td></tr></table>`,
    ),
  ].join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:10px 0 0">
${f.why ? `<tr><td colspan="3" style="${BOX}background:#f9fafb"><div style="${LABEL}">Why it matters</div>${esc(f.why)}</td></tr><tr><td colspan="3" style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>` : ''}
${row([panel('When to bring it up', f.when ? esc(f.when) : muted('Not written yet')), panel('Who should get it', who)])}
${row([panel('What CS has to do', csInner, f.cs ? ';border-left:3px solid #f0b429' : ''), panel('Turn it on', turnOn)])}
${row([panel('Where to find it', where), panel('Show the customer', show)])}
</table>`;
};

const cardHtml = (e) => {
  const f = enablementFacts(e, { base });
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 26px"><tr>
${thumbCell(e)}
<td valign="top" style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#101828">
  <div style="font-size:16px;font-weight:700;line-height:1.3;margin:0 0 4px"><a href="${f.links.enablement}" style="color:#101828;text-decoration:none">${esc(e.title)}</a></div>
  <div style="color:#667085;font-size:12px;margin:0 0 6px">${esc(e.module || 'Platform')}${e.kind ? ` · ${esc(e.kind)}` : ''} &nbsp;·&nbsp; <a href="${f.links.enablement}" style="color:#175cd3">Enablement notes</a></div>
  <div>${esc(shortSummary(e, 400))}</div>
</td></tr>
<tr><td colspan="2" style="padding:0">${factsHtml(e)}</td></tr></table>`;
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
<tr><td style="padding:0;font-family:Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef7c3;border-bottom:1px solid #f0d48a">
    <tr><td style="padding:12px 20px;font:13px/1.5 Helvetica,Arial,sans-serif;color:#713f12">
      <div style="font:700 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#a16207;margin:0 0 6px">SB Internal — staff only</div>
      <a href="${enablementHome}" style="color:#854d0e;font-weight:700;text-decoration:underline">Enablement notes</a>
      <span style="color:#ca8a04"> &nbsp;·&nbsp; </span>
      <a href="${releaseNotesUrl}" style="color:#854d0e;font-weight:700;text-decoration:underline">Release notes (customers)</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 28px 8px;font-family:Helvetica,Arial,sans-serif">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#667085;font-weight:600">Sessionboard · Product updates</div>
  <h1 style="font-size:22px;line-height:1.25;margin:6px 0 8px;color:#101828">${esc(headline)}</h1>
  <p style="margin:0;font-size:14px;line-height:1.5;color:#344054">${esc(sinceLine)} ${n} ${noun}, live for every organization (US + EU).</p>
</td></tr>
<tr><td style="padding:0 28px 28px">${sectionsHtml}</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #eaecf0;font:12px/1.5 Helvetica,Arial,sans-serif;color:#98a2b3">Sent every weekday morning by the Help Center's release workflow. Slack gets the same digest at the end of the day in #product-development. Source: <a href="https://github.com/lennd/sessionboard-docs" style="color:#98a2b3">lennd/sessionboard-docs</a> · src/data/release-notes.</td></tr>
</table></td></tr></table></body></html>`;

// ---------- plain text ----------

const text = [
  headline,
  'SB INTERNAL — staff only',
  `Enablement notes: ${enablementHome}`,
  `Release notes (customers): ${releaseNotesUrl}`,
  sinceLine,
  '',
  ...byModule(pending).flatMap(([module, entries]) => [
    `== ${module.toUpperCase()} (${entries.length}) ==`,
    ...entries.flatMap((e) => {
      const f = enablementFacts(e, { base });
      return [
        `* ${e.title}${e.kind ? ` (${e.kind})` : ''}`,
        `  ${shortSummary(e, 400)}`,
        f.why && `  Why it matters: ${f.why}`,
        f.when && `  When to bring it up: ${f.when}`,
        `  Who should get it: ${f.who.label} — ${f.who.short}${f.who.note ? `. ${f.who.note}` : ''}${f.who.seen_by.length ? ` (seen by ${f.who.seen_by.join(', ')})` : ''}`,
        `  What CS has to do: ${f.cs ? `${f.cs.action}${f.cs.note ? ` — ${f.cs.note}` : ''}` : CS_ACTION.none}`,
        `  Turn it on: Customer: ${f.turn_on.customer}${f.turn_on.staff ? ` | Staff: ${f.turn_on.staff}` : ''}${f.turn_on.flags.length ? ` | Flag: ${f.turn_on.flags.join(', ')}` : ''}`,
        (f.where.scope || f.where.path) && `  Where to find it: ${[f.where.scope, f.where.path].filter(Boolean).join(' — ')}`,
        f.show.guide && `  Show the customer: ${f.show.guide.title} ${f.show.guide.url}`,
        ...f.show.related.map((r) => `    ${r.title} ${r.url}`),
        ...f.show.videos.map((v) => `    ▶ ${v.title}${v.duration ? ` (${v.duration}s)` : ''} ${v.url}`),
        `  Enablement notes: ${f.links.enablement}`,
        '',
      ].filter((l) => l !== null && l !== undefined && l !== false);
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

if (TEST || NOW) {
  console.log(`✓ ${TEST ? 'Test email' : 'Email'} with ${n} update(s) sent to ${TO.join(', ')}; nothing marked.`);
  process.exit(0);
}
const touched = markSent(pending, 'email', today);
console.log(`✓ Emailed ${n} update(s) to ${TO.join(', ')}; marked emailed in ${touched} file(s).`);
