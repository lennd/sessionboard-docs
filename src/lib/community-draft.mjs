/**
 * Customer-facing Community "What's new" draft built from one release entry.
 * Pure, so the test can prove `internal.*` never leaks into the draft.
 */
import { AVAILABILITY, ENABLE_HOW, stripInline } from './release-notes.mjs';

/** The label that ties a Community entry back to its release entry. */
export const labelFor = (entry) => `release:${entry.id}`.slice(0, 80);

const enableLine = (e) => {
  if (e.enable.how === 'default_on' && !e.enable.path) return 'On for every organization — there is nothing to turn on.';
  if (e.enable.path) return e.enable.path.endsWith('.') ? e.enable.path : `${e.enable.path}.`;
  return `${ENABLE_HOW[e.enable.how] || 'See the guide'}.`;
};

/** Customer-facing markdown for one entry. Never reads `internal`. */
export function draftFor(entry, base) {
  const who = AVAILABILITY[entry.availability]?.label || 'Everyone';
  const whoShort = AVAILABILITY[entry.availability]?.short;
  const lines = [stripInline(entry.summary), ''];
  if (entry.use_case) lines.push(`**Why you'd use it** — ${entry.use_case}`, '');
  lines.push(`**Who gets it** — ${who}${whoShort && entry.availability !== 'everyone' ? ` (${whoShort.toLowerCase()})` : ''}.`);
  lines.push(`**How to turn it on** — ${enableLine(entry)}`);
  if (entry.where?.path) lines.push(`**Where** — ${entry.where.path}.`);
  lines.push('');
  if (entry.article) lines.push(`[Read the guide](${base}${entry.article}) · [All release notes](${base}/help/release-notes)`);
  return {
    title: entry.title,
    detailsMarkdown: lines.join('\n').trim(),
    types: [entry.kind || 'new'],
    labels: [labelFor(entry), ...(entry.module ? [entry.module] : [])],
  };
}

