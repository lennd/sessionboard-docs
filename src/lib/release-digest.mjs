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

import { mediaForEntry } from './article-media.mjs';
import {
  AVAILABILITY,
  CS_ACTION,
  DATA_DIR,
  ENABLE_HOW,
  allEntries,
  articleTitle,
  internalPrefix,
  isLive,
  readContract,
  readSite,
  stripInline,
  videosForArticle,
} from './release-notes.mjs';

const SCOPE_LABEL = { org: 'Organization', event: 'Event', both: 'Organization and event' };
const CS_LABEL = { none: 'Nothing', must_enable: 'Must enable', can_disable: 'Can disable', review_before_customers_see: 'Review with customer', reach_out: 'Reach out' };

let _contract;
/**
 * The seven panels of an entry's Enablement page as plain data, so the Slack
 * post, the morning email, the release feed and the TAM Hub all carry the same
 * line items a CSM sees on /enablement/releases/<id>: why it matters, when to
 * bring it up, who should get it, what CS has to do, how to turn it on
 * (customer and staff), where to find it, and what to show the customer
 * (guide, related guides, the pertinent training chapter or clip).
 */
export function enablementFacts(entry, { base = null, site = readSite() } = {}) {
  _contract ||= readContract();
  const host = base || `https://${site.canonicalHost}`;
  const prefix = internalPrefix(site);
  const abs = (p) => (p ? (/^https?:/.test(p) ? p : `${host}${p}`) : null);
  const i = entry.internal || {};
  const csKind = i.cs_action?.kind || 'none';
  const flags = (entry.features || []).map((f) => _contract.featureNames?.[f] || f);

  const pertinent = mediaForEntry(entry).filter((m) => m.type === 'video');
  const videos = (pertinent.length ? pertinent : entry.article ? videosForArticle(entry.article) : []).map((v) => ({
    title: v.title || 'Watch the walkthrough',
    url: abs(v.anchor || (entry.article ? entry.article.replace(/#.*$/, '') : null)),
    kind: v.kind === 'training' || v.id ? 'Training chapter' : 'Walkthrough clip',
    duration: v.duration ? Math.round(v.duration) : null,
    poster: abs(v.poster),
  }));
  for (const v of i.videos || []) videos.push({ title: v.title || v.url || v, url: v.url || v, kind: 'Video', duration: null, poster: null });

  return {
    why: entry.use_case || null,
    when: i.when_to_bring_up || null,
    who: {
      label: AVAILABILITY[entry.availability]?.label || 'Everyone',
      short: AVAILABILITY[entry.availability]?.short || 'On for every organization',
      note: i.who_should_get_it || null,
      seen_by: entry.audience || [],
    },
    cs: csKind === 'none' ? null : { kind: csKind, label: CS_LABEL[csKind] || csKind, action: CS_ACTION[csKind], note: i.cs_action?.note || null },
    turn_on: {
      customer: `${ENABLE_HOW[entry.enable?.how] || 'See the guide'}${entry.enable?.path ? ` — ${entry.enable.path}` : ''}`,
      staff: i.staff_path || null,
      flags,
    },
    where: { scope: SCOPE_LABEL[entry.where?.scope] || null, path: entry.where?.path || null },
    show: {
      guide: entry.article ? { title: articleTitle(entry.article), url: abs(entry.article) } : null,
      related: (entry.related || []).map((r) => ({ title: articleTitle(r), url: abs(r) })),
      videos,
    },
    gotchas: i.gotchas || null,
    links: { enablement: `${host}${prefix}/releases/${entry.id}`, release: `${host}/help/release-notes#${entry.id}` },
  };
}

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

const CS_RANK = { must_enable: 0, review_before_customers_see: 1, can_disable: 2, reach_out: 3, none: 4 };

/**
 * The few entries the email leads with: whatever CS has to act on first
 * (must enable, then review, can disable, reach out, then nothing), newest
 * release date first within each tier.
 */
export function topForEmail(entries, n = 5) {
  return [...entries]
    .sort((a, b) => {
      const ra = CS_RANK[a.internal?.cs_action?.kind || 'none'] ?? 4;
      const rb = CS_RANK[b.internal?.cs_action?.kind || 'none'] ?? 4;
      return ra - rb || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    })
    .slice(0, n);
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
