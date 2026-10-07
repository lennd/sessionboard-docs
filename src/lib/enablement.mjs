/**
 * Helpers for the staff-only enablement section (src/pages/<internalPrefix>/).
 *
 * The section reads the same release data as the public page but shows the
 * `internal.*` block and staged entries too. Everything that decides how a
 * release is described to CS lives here so the index, the module pages, the
 * detail page and the Slack digest agree.
 */

import { CS_ACTION, MODULES, internalPrefix, isLive } from './release-notes.mjs';

/** Production status of one entry, for a status pill. */
export function statusOf(entry) {
  const live = entry.shipped?.live || {};
  if (isLive(entry)) {
    const since = [live.us, live.eu].sort().at(-1);
    return { state: 'live', label: 'Live', since, detail: `US ${live.us} · EU ${live.eu}${live.me ? ` · ME ${live.me}` : ' · ME pending'}` };
  }
  if (live.us || live.eu) {
    const where = live.us ? 'US' : 'EU';
    const missing = live.us ? 'EU' : 'US';
    return { state: 'partial', label: `Live in ${where} only`, since: null, detail: `${missing} not deployed yet — do not announce` };
  }
  if (entry.shipped?.docs_only) return { state: 'live', label: 'Live', since: entry.date, detail: 'Docs-only change' };
  return { state: 'staged', label: 'Not in production yet', since: null, detail: 'Merged to main, waiting for the next production deploy' };
}

/** Tone used for the CS-action badge. */
export function csTone(kind) {
  switch (kind) {
    case 'must_enable':
      return 'danger';
    case 'can_disable':
    case 'review_before_customers_see':
      return 'warn';
    case 'reach_out':
      return 'info';
    default:
      return 'muted';
  }
}

export function csLabel(kind) {
  switch (kind) {
    case 'must_enable':
      return 'CS must enable';
    case 'can_disable':
      return 'CS can disable';
    case 'review_before_customers_see':
      return 'Review with customer';
    case 'reach_out':
      return 'Reach out';
    default:
      return 'No CS action';
  }
}

export function csDescription(kind) {
  return CS_ACTION[kind] || CS_ACTION.none;
}

/** GitHub URL for a `lennd/repo#123` or `repo#123` reference. */
export function prUrl(ref) {
  const m = /^(?:([a-z0-9-]+)\/)?([a-z0-9-]+)#(\d+)$/i.exec(String(ref));
  if (!m) return null;
  return `https://github.com/${m[1] || 'lennd'}/${m[2]}/pull/${m[3]}`;
}

export function moduleSlug(module) {
  return String(module || 'platform')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function moduleFromSlug(slug) {
  return MODULES.find((m) => moduleSlug(m) === slug) || null;
}

/**
 * Sidebar for the section, in Starlight's user-config shape (the
 * `<StarlightPage sidebar>` prop takes the same format as astro.config.mjs;
 * Starlight marks the current page from the URL).
 */
export function enablementSidebar(site, { modulesPresent = MODULES } = {}) {
  const prefix = internalPrefix(site);
  return [
    {
      label: 'Enablement',
      items: [
        { label: 'What shipped', link: prefix },
        { label: 'Needs CS action', link: `${prefix}/cs-action` },
        { label: 'Feature availability', link: `${prefix}/features` },
        { label: 'How to use this section', link: `${prefix}/how-to-use` },
      ],
    },
    {
      label: 'By module',
      items: modulesPresent.map((m) => ({ label: m, link: `${prefix}/modules/${moduleSlug(m)}` })),
    },
    {
      label: 'Customer-facing',
      items: [
        { label: 'Release notes', link: '/help/release-notes' },
        { label: 'Help Center home', link: '/' },
      ],
    },
  ];
}
