/**
 * Release notes as data.
 *
 * One file per release date under src/data/release-notes/YYYY-MM-DD.json is
 * the single source for everything that says "this shipped": the public
 * release-notes page, the internal enablement section, the daily Slack digest,
 * dist/_internal/release-notes.json (TAM Hub, Community drafts, Team Lead) and
 * the CI checks. Nothing else is allowed to hold its own list of what shipped.
 *
 * Every entry answers the questions CS gets asked — what module, who gets it,
 * how it is turned on, where it lives, why a customer would want it — and
 * carries a `shipped` block that says whether it is actually in production.
 * Public surfaces render only live entries; the internal section shows staged
 * ones too, marked as such, so nobody goes looking in the product for a thing
 * that is only on main.
 *
 * `internal.*` never reaches a public surface: `publicEntry()` is the only
 * shape the public page, the feed and the digest are given.
 *
 * Plain JS on purpose — the same module is imported by Astro components, the
 * CI check and the Node scripts, and none of them should need a schema library.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repo root is the nearest ancestor holding site.json. Resolved by walking
 * up rather than by a fixed `../..` because Astro bundles this module into
 * dist/.prerender/chunks/ at build time, where the relative path is wrong.
 */
function findRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'site.json')) && existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const ROOT = findRoot();
export const DATA_DIR = join(ROOT, 'src', 'data', 'release-notes');
const DOCS_DIR = join(ROOT, 'src', 'content', 'docs');

/** Entries dated on or after this day must carry every field; earlier ones were migrated from prose. */
export const CUTOVER = '2026-10-07';

/** Sidebar groups a change is filed under. Mirrors the Help Center's Guides groups plus the two cross-cutting ones. */
export const MODULES = [
  'Program',
  'CRM',
  'Marketing',
  'CMS',
  'Learning',
  'Awards',
  'Portals',
  'Communications',
  'Automations',
  'Reporting',
  'Agents',
  'Event team',
  'Settings',
  'Apps',
  'Platform',
];

export const KINDS = ['new', 'improved', 'fixed'];

/** Who gets it. Derived from the product contract when `features` is set; always overridable. */
export const AVAILABILITY = {
  everyone: { label: 'Everyone', short: 'On for every organization' },
  preview: { label: 'Early Access Preview', short: 'Self-serve from Preview' },
  beta: { label: 'Early Access Beta', short: 'Request from Preview; our team enables it' },
  add_on: { label: 'Add-on', short: 'Sold separately; ask your Customer Success Manager' },
  on_request: { label: 'On request', short: 'Support enables it for your organization or event' },
  limited_release: { label: 'Limited release', short: 'Enabled for named customers by their Customer Success Manager' },
  enterprise: { label: 'Enterprise', short: 'Enterprise plans' },
};

/** How the customer turns it on. */
export const ENABLE_HOW = {
  default_on: 'On by default — nothing to turn on',
  setting: 'Turn on a setting',
  self_serve: 'Toggle it on from Preview',
  support: 'Ask support to enable it',
  csm: 'Ask your Customer Success Manager',
};

/** What CS has to do. Internal only. */
export const CS_ACTION = {
  none: 'Nothing — it is on for everyone',
  must_enable: 'CS must enable it for the customer',
  can_disable: 'CS can turn it off for a customer who asks',
  review_before_customers_see: 'Review the setup with the customer before they find it',
  reach_out: 'Reach out — a good moment to show it off',
};

export const SCOPES = ['org', 'event', 'both'];
export const AUDIENCES = ['organizer', 'reviewer', 'speaker', 'participant'];

/** Prefix for the staff-only enablement section; configured in site.json so nothing hardcodes it. */
export function internalPrefix(site = readSite()) {
  return `/${String(site.internalPrefix || 'enablement').replace(/^\/|\/$/g, '')}`;
}

export function readSite() {
  return JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
}

export function readContract() {
  return JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'product-contract.json'), 'utf8'));
}

// ── module from article path ───────────────────────────────────────────────

const MODULE_BY_FOLDER = {
  sessions: 'Program',
  evaluations: 'Program',
  speakers: 'Program',
  applications: 'Program',
  concepts: 'Program',
  'speaker-crm': 'CRM',
  marketing: 'Marketing',
  videos: 'Marketing',
  site: 'CMS',
  awards: 'Awards',
  portals: 'Portals',
  participants: 'Portals',
  communications: 'Communications',
  automations: 'Automations',
  reporting: 'Reporting',
  agents: 'Agents',
  'event-team': 'Event team',
  settings: 'Settings',
  events: 'Settings',
  apps: 'Apps',
  integrations: 'Apps',
  learning: 'Learning',
  'get-started': 'Platform',
  faq: 'Platform',
  help: 'Platform',
};

/** Best-effort module for an article path; `null` when the folder is unknown. */
export function moduleForPath(path) {
  const folder = String(path || '').replace(/^\//, '').split(/[/#]/)[0];
  return MODULE_BY_FOLDER[folder] || null;
}

// ── availability derived from the product contract ─────────────────────────

/** Core modules every organization has, whatever admin category they are filed under. */
const CORE_FEATURES = new Set(['sessions', 'applications']);

/**
 * Who gets a feature, from the contract alone: Early Access stage first, then
 * the admin category each scope files it under.
 */
export function deriveAvailability(slug, contract) {
  const fa = contract.featureAvailability?.[slug];
  if (!fa) return null;
  if (CORE_FEATURES.has(slug)) return 'everyone';
  // Lifecycle is the registry's own word for a feature with no admin toggle.
  // `adminHidden` alone is not "on for everyone": Studio and AI Evaluators
  // are hidden because they were retired (contract v4, web-api #4344).
  const lifecycle = featureLifecycle(slug, contract);
  if (lifecycle === 'retired') return null;
  if (lifecycle === 'merged') {
    const into = Object.values(fa.scopes || {}).map((s) => s.mergedInto).find(Boolean);
    return into && into !== slug ? deriveAvailability(into, contract) : 'everyone';
  }
  if (lifecycle === 'ga') return 'everyone';
  if (fa.earlyAccess?.stage === 'preview') return 'preview';
  if (fa.earlyAccess?.stage === 'beta') return 'beta';
  const scopes = Object.values(fa.scopes || {});
  if (scopes.some((s) => s.adminCategory === 'products')) return 'add_on';
  if (scopes.some((s) => s.adminCategory === 'features_enhancements')) return 'on_request';
  if (scopes.some((s) => s.adminCategory === 'early_access' || s.adminCategory === 'alpha')) return 'limited_release';
  return 'everyone';
}

/** `active` | `ga` | `merged` | `retired` — or `active` for contracts older than v4. */
export function featureLifecycle(slug, contract) {
  const fa = contract.featureAvailability?.[slug];
  if (!fa) return 'active';
  if (fa.lifecycle) return fa.lifecycle;
  const scopes = Object.values(fa.scopes || {}).map((s) => s.lifecycle).filter(Boolean);
  if (scopes.includes('retired')) return 'retired';
  if (scopes.includes('merged')) return 'merged';
  return scopes.length > 0 && scopes.every((l) => l === 'ga') ? 'ga' : 'active';
}

/** The feature whose toggle now covers a merged one, or null. */
export function mergedInto(slug, contract) {
  const fa = contract.featureAvailability?.[slug];
  return Object.values(fa?.scopes || {}).map((s) => s.mergedInto).find(Boolean) || null;
}

export function deriveEnableHow(availability) {
  switch (availability) {
    case 'preview':
      return 'self_serve';
    case 'beta':
    case 'on_request':
      return 'support';
    case 'add_on':
    case 'limited_release':
    case 'enterprise':
      return 'csm';
    default:
      return 'default_on';
  }
}

export function deriveScope(slugs, contract) {
  const set = new Set();
  for (const slug of slugs || []) for (const s of contract.featureScopes?.[slug] || []) set.add(s);
  if (set.size === 2) return 'both';
  return set.size === 1 ? [...set][0] : null;
}

/** The availability block the <Availability> component and the matrix render for one feature. */
export function featureFacts(slug, contract) {
  const fa = contract.featureAvailability?.[slug];
  const availability = deriveAvailability(slug, contract);
  return {
    slug,
    name: contract.featureNames?.[slug] || slug,
    scopes: contract.featureScopes?.[slug] || [],
    availability,
    enable_how: deriveEnableHow(availability),
    early_access: fa?.earlyAccess || null,
    admin_category: fa ? Object.values(fa.scopes || {}).map((s) => s.adminCategory).filter(Boolean)[0] || null : null,
    lifecycle: featureLifecycle(slug, contract),
    merged_into: mergedInto(slug, contract),
    graduated: featureLifecycle(slug, contract) === 'ga',
    involves_ai: !!fa?.involvesAi,
    description: fa ? Object.values(fa.scopes || {}).map((s) => s.description).filter(Boolean)[0] || null : null,
  };
}

// ── loading and validation ─────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PR_RE = /^(?:lennd\/)?[a-z0-9-]+#\d+$/;

function articleExists(path) {
  const clean = String(path).replace(/#.*$/, '').replace(/^\//, '');
  if (!clean) return false;
  return existsSync(join(DOCS_DIR, `${clean}.mdx`)) || existsSync(join(DOCS_DIR, clean, 'index.mdx'));
}

/**
 * Validate one entry. Returns a list of problems (empty when valid) and fills
 * derived defaults in place so every consumer sees the same resolved shape.
 */
export function validateEntry(entry, date, contract, { file = '' } = {}) {
  const problems = [];
  const at = (msg) => problems.push(`${file} [${entry.id || '?'}] ${msg}`);
  const strict = date >= CUTOVER;

  if (!entry.id || !ID_RE.test(entry.id)) at('id must be a kebab-case slug');
  if (!entry.title || typeof entry.title !== 'string') at('title is required');
  if (!entry.summary || typeof entry.summary !== 'string') at('summary is required');
  if (entry.article && !articleExists(entry.article)) at(`article ${entry.article} does not resolve to an MDX page`);
  for (const r of entry.related || []) if (!articleExists(r)) at(`related ${r} does not resolve to an MDX page`);
  if (entry.kind && !KINDS.includes(entry.kind)) at(`kind must be one of ${KINDS.join(', ')}`);
  if (entry.module && !MODULES.includes(entry.module)) at(`module "${entry.module}" is not one of ${MODULES.join(', ')}`);
  for (const f of entry.features || []) {
    if (!contract.features.includes(f)) {
      at(`feature "${f}" is not in the product contract`);
      continue;
    }
    const lifecycle = featureLifecycle(f, contract);
    if (lifecycle === 'retired') at(`feature "${f}" is retired — nothing ships under it; drop the tag`);
    if (lifecycle === 'merged') at(`feature "${f}" was folded into "${mergedInto(f, contract)}" — tag that instead`);
  }
  for (const p of entry.permissions || []) if (!(contract.permissions || []).includes(p)) at(`permission "${p}" is not in the product contract`);
  for (const a of entry.audience || []) if (!AUDIENCES.includes(a)) at(`audience "${a}" unknown`);
  if (entry.availability && !AVAILABILITY[entry.availability]) at(`availability "${entry.availability}" unknown`);
  if (entry.enable?.how && !ENABLE_HOW[entry.enable.how]) at(`enable.how "${entry.enable.how}" unknown`);
  if (entry.where?.scope && !SCOPES.includes(entry.where.scope)) at(`where.scope "${entry.where.scope}" unknown`);
  if (entry.internal?.cs_action?.kind && !CS_ACTION[entry.internal.cs_action.kind]) at(`internal.cs_action.kind "${entry.internal.cs_action.kind}" unknown`);
  for (const pr of entry.shipped?.prs || []) if (!PR_RE.test(pr)) at(`shipped.prs "${pr}" must look like lennd/sessionboard-web-api#4120`);
  for (const [region, value] of Object.entries(entry.shipped?.live || {})) {
    if (!['us', 'eu', 'me'].includes(region)) at(`shipped.live.${region} is not a region`);
    if (value !== null && !DATE_RE.test(String(value))) at(`shipped.live.${region} must be YYYY-MM-DD or null`);
  }

  // Derived defaults — written back so the resolved entry is what every surface sees.
  const primary = (entry.features || [])[0];
  if (!entry.module) entry.module = moduleForPath(entry.article) || (strict ? null : 'Platform');
  if (!entry.availability) entry.availability = (primary && deriveAvailability(primary, contract)) || 'everyone';
  entry.enable = { how: deriveEnableHow(entry.availability), path: null, ...(entry.enable || {}) };
  entry.where = { scope: deriveScope(entry.features, contract), path: null, ...(entry.where || {}) };
  entry.related = entry.related || [];
  entry.features = entry.features || [];
  entry.permissions = entry.permissions || [];
  entry.audience = entry.audience?.length ? entry.audience : ['organizer'];
  entry.internal = { cs_action: { kind: 'none', note: null }, ...(entry.internal || {}) };
  entry.internal.cs_action = { kind: 'none', note: null, ...(entry.internal.cs_action || {}) };
  entry.shipped = {
    prs: [],
    docs_only: false,
    pending: null,
    live: { us: null, eu: null, me: null },
    announced_at: null,
    ...(entry.shipped || {}),
  };
  entry.shipped.live = { us: null, eu: null, me: null, ...(entry.shipped.live || {}) };

  if (strict) {
    if (!entry.kind) at('kind is required');
    if (!entry.module) at('module is required (could not derive it from the article path)');
    if (!entry.article) at('article is required — every change links to the guide that covers it');
    if (!entry.use_case) at('use_case is required — why would a customer want this?');
    if (!entry.enable.path && entry.enable.how !== 'default_on') at('enable.path is required when the feature is not on by default');
    if (!entry.where.path) at('where.path is required — the menu path where the change shows up');
    if (!entry.internal.when_to_bring_up) at('internal.when_to_bring_up is required for CS');
    if (!entry.shipped.docs_only && entry.shipped.prs.length === 0 && !entry.shipped.pending) {
      at('shipped.prs is required (or shipped.docs_only: true, or shipped.pending: "<branch or ticket>" while the PR does not exist yet)');
    }
    if (entry.shipped.pending && typeof entry.shipped.pending !== 'string') at('shipped.pending must be a short string naming the branch or ticket');
  }

  return problems;
}

/**
 * Load every release file, validate, and return `{ releases, problems }` where
 * `releases` is sorted newest first and each entry is resolved.
 */
export function loadReleaseNotes({ contract = readContract() } = {}) {
  const releases = [];
  const problems = [];
  if (!existsSync(DATA_DIR)) return { releases, problems: [`${DATA_DIR} does not exist`] };

  for (const name of readdirSync(DATA_DIR).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const file = `src/data/release-notes/${name}`;
    const date = name.replace(/\.json$/, '');
    if (!DATE_RE.test(date)) {
      problems.push(`${file}: file name must be YYYY-MM-DD.json`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    if (data.date !== date) problems.push(`${file}: "date" (${data.date}) does not match the file name`);
    if (!Array.isArray(data.entries)) {
      problems.push(`${file}: "entries" must be an array`);
      continue;
    }
    const seen = new Set();
    for (const entry of data.entries) {
      problems.push(...validateEntry(entry, date, contract, { file }));
      if (seen.has(entry.id)) problems.push(`${file} [${entry.id}] duplicate id in this release`);
      seen.add(entry.id);
      entry.date = date;
    }
    releases.push({ date, entries: data.entries });
  }

  // Ids must be unique across the whole history: they are URLs.
  const ids = new Map();
  for (const r of releases) for (const e of r.entries) {
    if (ids.has(e.id)) problems.push(`[${e.id}] appears in both ${ids.get(e.id)} and ${r.date}`);
    ids.set(e.id, r.date);
  }

  releases.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { releases, problems };
}

/** Flat list of resolved entries, newest release first. */
export function allEntries(releases) {
  return releases.flatMap((r) => r.entries);
}

/** In production for every customer: both main regions are live (ME lags and is informational). */
export function isLive(entry) {
  const live = entry.shipped?.live || {};
  return !!(live.us && live.eu);
}

/** Entries whose article is live — the only ones public surfaces may show. */
export function liveReleases(releases) {
  return releases
    .map((r) => ({ date: r.date, entries: r.entries.filter(isLive) }))
    .filter((r) => r.entries.length > 0);
}

/** The shape public surfaces and the feed receive. `internal` is removed, never masked. */
export function publicEntry(entry) {
  const { internal, ...rest } = entry;
  return rest;
}

// ── videos cited by an article ─────────────────────────────────────────────

const TRAINING_RE = /<TrainingVideo\s+([^>]*?)>/g;
const WALKTHROUGH_RE = /<Walkthrough\s+([^>]*?)\/?>/g;

function attr(attrs, name) {
  const quoted = new RegExp(`\\b${name}=(?:"([^"]*)"|\\{"([^"]*)"\\}|\\{([^}]*)\\})`).exec(attrs);
  if (!quoted) return null;
  return quoted[1] ?? quoted[2] ?? quoted[3] ?? null;
}

/**
 * Training chapters and walkthrough clips embedded in an article, so a release
 * page can link the video that shows the feature without anyone curating a
 * second list. `start` is the chapter marker the article was scripted from.
 */
export function videosForArticle(path) {
  const clean = String(path || '').replace(/#.*$/, '').replace(/^\//, '');
  const file = join(DOCS_DIR, `${clean}.mdx`);
  if (!clean || !existsSync(file)) return [];
  const source = readFileSync(file, 'utf8');
  const out = [];
  for (const m of source.matchAll(TRAINING_RE)) {
    const a = m[1];
    out.push({
      kind: 'training',
      id: attr(a, 'id'),
      title: attr(a, 'title'),
      src: attr(a, 'src'),
      poster: attr(a, 'poster'),
      start: Number(attr(a, 'start') || 0),
      duration: Number(attr(a, 'duration') || 0),
      anchor: `/${clean}#${attr(a, 'id')}`,
    });
  }
  for (const m of source.matchAll(WALKTHROUGH_RE)) {
    const a = m[1];
    out.push({ kind: 'walkthrough', id: null, title: attr(a, 'title'), src: attr(a, 'src'), poster: null, start: 0, duration: 0, anchor: `/${clean}` });
  }
  return out;
}

/** Title from an article's frontmatter, for link text. */
export function articleTitle(path) {
  const clean = String(path || '').replace(/#.*$/, '').replace(/^\//, '');
  const file = join(DOCS_DIR, `${clean}.mdx`);
  if (!clean || !existsSync(file)) return clean;
  const m = /^title:\s*["']?(.*?)["']?\s*$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1] : clean;
}

// ── inline markdown → HTML for summaries ───────────────────────────────────

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Summaries are one sentence of our own prose with bold, code and links. This
 * renders exactly those three, after escaping, so a data file can never inject
 * markup into the page.
 */
export function renderInline(markdown) {
  let html = escapeHtml(sentence(markdown || ''));
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  return html;
}

/**
 * Upper-case the first letter. Migrated summaries continued their title
 * ("**Title** — a new permission…"); rendered on their own they open a sentence.
 * Leaves markup-leading text (`**`, `[`, `` ` ``) alone.
 */
export function sentence(text) {
  const s = String(text || '');
  return s.replace(/^([a-z])/, (c) => c.toUpperCase());
}

/** Plain text of a summary, for Slack and feeds. */
export function stripInline(markdown) {
  return sentence(
    String(markdown || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|`|\*/g, ''),
  );
}

/** "October 6, 2026" */
export function formatDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
