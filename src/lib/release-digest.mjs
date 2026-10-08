/**
 * What the Slack post and the morning email have in common.
 *
 * Two channels, two markers, one rule: a channel's digest is every entry that
 * is live in production and that this channel has not sent yet. Slack writes
 * `shipped.announced_at`, email writes `shipped.emailed_at`, so each recaps
 * exactly what went live since its own previous send — Slack at the end of
 * the day, email the next morning — and neither can repeat itself.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AVAILABILITY, CS_ACTION, DATA_DIR, allEntries, isLive, stripInline } from './release-notes.mjs';

export const CHANNELS = {
  slack: { field: 'announced_at', label: 'Slack' },
  email: { field: 'emailed_at', label: 'email' },
};

/** Entries this channel still has to send, oldest release date first. */
export function pendingFor(releases, channel, { since = null } = {}) {
  const { field } = CHANNELS[channel];
  return allEntries(releases)
    .filter((e) => isLive(e) && (since ? e.date >= since : !e.shipped[field]))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The date this channel last sent anything, for "since …" copy. */
export function lastSentFor(releases, channel) {
  const { field } = CHANNELS[channel];
  return allEntries(releases)
    .map((e) => e.shipped[field])
    .filter(Boolean)
    .sort()
    .pop() || null;
}

/** Group by module, biggest module first, preserving entry order inside. */
export function byModule(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.module || 'Platform';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

export function enableText(e) {
  if (e.enable.how === 'default_on' && !e.enable.path) return 'On for everyone — nothing to turn on';
  return e.enable.path || AVAILABILITY[e.availability]?.short || 'See the guide';
}

export function whoText(e) {
  const who = AVAILABILITY[e.availability]?.label || 'Everyone';
  const scope = e.where?.scope ? ` (${e.where.scope === 'both' ? 'org + event' : e.where.scope})` : '';
  return `${who}${scope}`;
}

export const CS_EMOJI = { must_enable: ':rotating_light:', can_disable: ':warning:', review_before_customers_see: ':eyes:', reach_out: ':mega:' };

/** "CS: Turn it on for the customer — note", or null when CS has nothing to do. */
export function csText(e) {
  const kind = e.internal?.cs_action?.kind || 'none';
  if (kind === 'none') return null;
  const note = e.internal.cs_action.note ? ` — ${e.internal.cs_action.note}` : '';
  return { kind, text: `${CS_ACTION[kind]}${note}` };
}

/** Summary trimmed to one readable line. */
export function shortSummary(e, max = 220) {
  return stripInline(e.summary).replace(new RegExp(`^(.{0,${max}}\\S)(\\s.*)?$`, 's'), (m, head, tail) => (tail ? `${head}…` : head));
}

/** Stamp the channel's marker on the sent entries, touching only their files. */
export function markSent(entries, channel, today) {
  const { field } = CHANNELS[channel];
  const touched = new Set(entries.map((e) => e.date));
  for (const date of touched) {
    const file = join(DATA_DIR, `${date}.json`);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const ids = new Set(entries.filter((e) => e.date === date).map((e) => e.id));
    for (const raw of data.entries) {
      if (!ids.has(raw.id)) continue;
      raw.shipped = { ...(raw.shipped || {}), [field]: today };
    }
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return touched.size;
}
