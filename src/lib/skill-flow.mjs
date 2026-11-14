/**
 * The "You ask → It works → You get" strip on every skill's page (SkillFlow.astro),
 * built from the skill's entry in public/skills/downloads/skills.json:
 *
 *   You ask   the skill's first example prompt;
 *   It works  a few of the tools it calls, then — when the skill changes anything —
 *             "Waits for your OK" and the first change it makes after that OK;
 *   You get   a small drawing of the outcome, one per product group (src/lib/skills.mjs
 *             SKILL_PRODUCTS), so a new skill gets one without anyone drawing it.
 *
 * Drawings follow the 2027 illustration grammar: abstract shapes, page tokens only
 * (classes below map to Starlight colors in SkillFlow.astro), thin round strokes, one
 * accent-filled element as the focal point. Decorative: the panel's text says the same.
 */

/** Tools that only locate things; they say nothing about what the skill does. */
const GENERIC = new Set([
  'Find event',
  'List events',
  'Find people',
  'Get contact',
  'Get Sessions Home',
  'Get Awards Home',
  'Get a Sessions event',
  'List Awards programs',
  'List metadata',
  'List Sites',
]);

import { SKILL_FLOWS } from '../data/skill-flows.mjs';

const wrap = (body) =>
  `<svg viewBox="0 0 168 112" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/**
 * The strip for one skill: its hand-written entry in src/data/skill-flows.mjs (steps and
 * outcome unique to that skill), or, for a skill not written up yet, the generic version
 * from its tools and product group.
 */
export function stripFor(skill) {
  const own = SKILL_FLOWS[skill.id];
  const auto = flowFor(skill);
  if (!own) return { ...auto, get: OUTCOMES[skill.product] ?? OUTCOMES.insights, own: false };
  const ask = own.ask ?? auto.ask;
  return { ask, steps: own.works, get: { label: own.get.label, svg: wrap(own.get.svg) }, own: true };
}

export function flowFor(skill, { reads = 2 } = {}) {
  const full = String(skill.prompts?.[0] ?? skill.starterPrompt ?? '').split('\n')[0].trim();
  // Keep the bubble to a few lines: cut at a word, never mid-word.
  const ask = full.length <= 110 ? full : `${full.slice(0, 110).replace(/\s+\S*$/, '')}…`;
  const read = skill.tools.filter((t) => t.access === 'read');
  const write = skill.tools.filter((t) => t.access !== 'read');
  const useful = read.filter((t) => !GENERIC.has(t.title));
  const picked = (useful.length >= reads ? useful : read).slice(0, write.length ? reads : reads + 1);
  const steps = picked.map((t) => ({ kind: 'done', label: t.title }));
  if (write.length) {
    steps.push({ kind: 'wait', label: 'Waits for your OK' });
    steps.push({ kind: 'next', label: write[0].title });
  }
  return { ask, steps };
}

const svg = (body, label) =>
  `<svg viewBox="0 0 168 112" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-label="${label}">${body}</svg>`;

/** One outcome drawing per product group. Keys match SKILL_PRODUCTS. */
export const OUTCOMES = {
  // A rooms × times grid with one session placed.
  program: {
    label: 'Agenda, live',
    svg: svg(
      `<rect class="ink" x="8" y="8" width="152" height="96" rx="8"/>
       <path class="ln" d="M8 30h152M58 30v74M110 30v74M8 67h152"/>
       <path class="mut" d="M18 19h44"/>
       <rect class="mut" x="14" y="36" width="38" height="24" rx="4"/>
       <rect class="fac" x="64" y="73" width="40" height="24" rx="4"/>
       <rect class="mut" x="116" y="36" width="38" height="24" rx="4"/>
       <rect class="mut" x="116" y="73" width="38" height="24" rx="4"/>`,
      'program',
    ),
  },
  // Scores as bars; the winner's bar ends in the accent dot.
  awards: {
    label: 'Winners picked',
    svg: svg(
      `<rect class="ink" x="8" y="8" width="152" height="96" rx="8"/>
       <path class="mut" d="M22 28h96M22 44h74M22 76h60M22 92h88"/>
       <path class="ac" stroke-width="3" d="M22 60h112"/>
       <circle class="fac" cx="140" cy="60" r="7"/>`,
      'awards',
    ),
  },
  // Learners as rows with progress; one completes.
  learning: {
    label: 'Learners on track',
    svg: svg(
      `<rect class="ink" x="8" y="8" width="152" height="96" rx="8"/>
       <circle class="mut" cx="26" cy="30" r="6"/><path class="ln" d="M42 30h102"/><path class="mut" d="M42 30h60"/>
       <circle class="mut" cx="26" cy="56" r="6"/><path class="ln" d="M42 56h102"/><path class="mut" d="M42 56h34"/>
       <circle class="fac" cx="26" cy="82" r="6"/><path class="ac" stroke-width="2.4" d="M42 82h102"/>`,
      'learning',
    ),
  },
  // People joined to one company.
  crm: {
    label: 'People in order',
    svg: svg(
      `<rect class="fac" x="66" y="42" width="36" height="28" rx="6"/>
       <g class="ln"><path d="M84 42 50 20M84 42l34-22M84 70 50 92M84 70l34 22M66 56H28M102 56h38"/></g>
       <circle class="ink" cx="44" cy="16" r="8" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="124" cy="16" r="8" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="44" cy="96" r="8" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="124" cy="96" r="8" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="20" cy="56" r="8" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="148" cy="56" r="8" fill="var(--sb-flow-bg)"/>`,
      'crm',
    ),
  },
  // Registrations climbing toward a target line.
  registration: {
    label: 'Registrations, answered',
    svg: svg(
      `<path class="ln" d="M12 100h148M12 100V12"/>
       <path class="mut" stroke-dasharray="3 5" d="M12 26h148"/>
       <path class="ac" stroke-width="2" d="M14 94c20-4 30-14 46-22s34-12 50-28 30-14 40-16"/>
       <circle class="fac" cx="150" cy="28" r="6"/>`,
      'registration',
    ),
  },
  // Dashboard tiles: a bar chart, a number, a line.
  insights: {
    label: 'Answers, sourced',
    svg: svg(
      `<rect class="ink" x="8" y="8" width="72" height="96" rx="8"/>
       <path class="mut" d="M24 88V64M40 88V48M56 88V58"/>
       <path class="ac" stroke-width="3" d="M72 88V28" transform="translate(-6 0)"/>
       <rect class="ink" x="88" y="8" width="72" height="42" rx="8"/>
       <rect class="fac" x="100" y="22" width="30" height="14" rx="3"/>
       <rect class="ink" x="88" y="58" width="72" height="46" rx="8"/>
       <path class="mut" d="M98 92l14-12 12 6 26-18"/>`,
      'insights',
    ),
  },
  // One recording becomes a reel and posts.
  marketing: {
    label: 'Content, out',
    svg: svg(
      `<rect class="ink" x="8" y="30" width="64" height="52" rx="8"/>
       <path class="mut" d="M18 56h4M26 48v16M32 52v8M38 44v24M44 50v12M50 54v4M56 47v18M62 53v6"/>
       <path class="ac" stroke-dasharray="3 5" d="M76 56h12"/>
       <rect class="fac" x="94" y="10" width="28" height="44" rx="5"/>
       <rect class="mut" x="128" y="10" width="32" height="20" rx="4"/>
       <rect class="mut" x="128" y="36" width="32" height="20" rx="4"/>
       <rect class="mut" x="94" y="62" width="66" height="40" rx="5"/>
       <path class="mut" d="M102 76h40M102 88h28"/>`,
      'marketing',
    ),
  },
  // A page of blocks with one changed block.
  sites: {
    label: 'Site, published',
    svg: svg(
      `<rect class="ink" x="28" y="6" width="112" height="100" rx="8"/>
       <path class="mut" d="M40 22h60"/>
       <rect class="mut" x="40" y="32" width="88" height="22" rx="4"/>
       <rect class="fac" x="40" y="60" width="88" height="16" rx="4"/>
       <path class="mut" d="M40 86h70M40 96h48"/>`,
      'sites',
    ),
  },
  // A day as a route through saved sessions.
  attend: {
    label: 'Your day, planned',
    svg: svg(
      `<path class="ac" stroke-dasharray="3 5" d="M18 92c20 0 24-30 46-30s26 26 46 26 22-60 42-60"/>
       <circle class="ink" cx="18" cy="92" r="7" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="64" cy="62" r="7" fill="var(--sb-flow-bg)"/>
       <circle class="ink" cx="110" cy="88" r="7" fill="var(--sb-flow-bg)"/>
       <circle class="fac" cx="152" cy="28" r="8"/>`,
      'attend',
    ),
  },
};
