/**
 * The signed-in reader, in the page.
 *
 * Reads /_account/me (src/lib/account-session.mjs) only when the
 * `sb_signed_in` hint cookie says a session exists, so signed-out visitors make
 * no request at all. Then:
 *
 *   - fills every AccountMenu.astro copy: name, avatar, the chosen event, and a
 *     panel with roles, where they signed in from, the org / event picker and
 *     sign-out;
 *   - reveals the sidebar's "For you" guides (ForYou.astro) for their roles,
 *     the one they signed in from first;
 *   - on an article written for someone else (`<meta name="sb-audience">`),
 *     says so and points at their guides;
 *   - with an event or org chosen, hydrates the article's personalization
 *     markers against it (src/lib/marker-hydration.mjs, the same code the
 *     in-product reader runs).
 *
 * Everything from the API is written with textContent / attributes, never
 * innerHTML.
 */
import { hydrateMarkers } from '../lib/marker-hydration.mjs';

const HINT = 'sb_signed_in=1';
const READER_CACHE = 'sb-account-reader';
const READER_TTL_MS = 5 * 60 * 1000;
const CONTEXT_KEY = 'sb-help-context';

const ROLE_LABELS = {
  organizer: 'Organizer',
  speaker: 'Speaker',
  reviewer: 'Reviewer',
  ready_room: 'Ready Room',
};
const VIA_LABELS = {
  admin: 'Sessionboard',
  portal: 'the speaker portal',
  event_portal: 'the event portal',
  org_portal: 'the reviewer portal',
  ready_room: 'Ready Room',
};
/** The article audience each role reads (frontmatter `audience`). */
const AUDIENCE_BY_ROLE = { organizer: 'organizer', speaker: 'participant', reviewer: 'reviewer', ready_room: 'organizer' };

const store = (area) => {
  try {
    return window[area];
  } catch {
    return null;
  }
};
const readJson = (area, key) => {
  try {
    return JSON.parse(store(area)?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const writeJson = (area, key, value) => {
  try {
    if (value == null) store(area)?.removeItem(key);
    else store(area)?.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: nothing persists, everything still works
  }
};

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
};

async function loadReader() {
  if (!document.cookie.split('; ').includes(HINT)) {
    writeJson('sessionStorage', READER_CACHE, null);
    return null;
  }
  const cached = readJson('sessionStorage', READER_CACHE);
  if (cached && Date.now() - cached.at < READER_TTL_MS) return cached.reader;
  try {
    const res = await fetch('/_account/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      writeJson('sessionStorage', READER_CACHE, null);
      return null;
    }
    const { reader } = await res.json();
    writeJson('sessionStorage', READER_CACHE, { at: Date.now(), reader });
    return reader;
  } catch {
    return cached?.reader ?? null;
  }
}

const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Signed in';
const initials = (r) =>
  ([r.first_name?.[0], r.last_name?.[0]].filter(Boolean).join('') || (r.email ?? '?')[0]).toUpperCase();

/** The saved choice, if it still names an org / event this reader has. */
function savedContext(reader) {
  const saved = readJson('localStorage', CONTEXT_KEY);
  if (!saved || reader.signed_in_via !== 'admin') return null;
  const org = reader.organizations.find((o) => o.id === saved.orgId);
  if (!org) return null;
  if (saved.eventId == null) return { orgId: org.id, eventId: null, name: org.name };
  const event = org.events.find((e) => String(e.id) === String(saved.eventId));
  return event ? { orgId: org.id, eventId: event.id, name: event.name } : null;
}

// ── Personalization ────────────────────────────────────────────────────

let appRoutes = null;
async function loadAppRoutes() {
  if (appRoutes) return appRoutes;
  try {
    appRoutes = await (await fetch('/app-routes.json')).json();
  } catch {
    appRoutes = {};
  }
  return appRoutes;
}

async function applyContext(reader, ctx) {
  const root = document.querySelector('.sl-markdown-content');
  if (!root) return;
  if (!ctx) {
    // Empty context = everything visible again (the hydrator's invariant).
    if (root.hasAttribute('data-sb-hydrated')) hydrateMarkers(root, {});
    return;
  }
  const query = ctx.eventId ? `eventId=${encodeURIComponent(ctx.eventId)}` : `orgId=${encodeURIComponent(ctx.orgId)}`;
  let server = null;
  try {
    const res = await fetch(`/_account/context?${query}`, { credentials: 'same-origin' });
    if (res.ok) server = (await res.json()).context;
  } catch {
    // unknown context: leave the page as published
  }
  const routes = await loadAppRoutes();
  const app = reader.app_origin;
  hydrateMarkers(root, {
    ...(server
      ? {
          eventName: server.event_name,
          features: server.features,
          settings: server.settings,
          permissions: server.permissions ?? {},
          contract: server.contract,
        }
      : {}),
    resolveRoute: (id) => {
      const target = routes[id];
      if (!target || !app) return null;
      if (target.scope === 'event') return ctx.eventId ? `${app}/event/${ctx.eventId}/${target.path}` : null;
      return ctx.orgId ? `${app}/org/${ctx.orgId}/${target.path}` : null;
    },
    routeLabel: (id) => routes[id]?.label ?? null,
    settingHref: () => (ctx.eventId && app ? `${app}/event/${ctx.eventId}/settings` : null),
  });
}

// ── Header ─────────────────────────────────────────────────────────────

function buildPanel(reader, ctx, onChoose) {
  const nodes = [
    el('p', { class: 'sb-acct-who', text: fullName(reader) }),
    reader.email ? el('p', { class: 'sb-acct-muted', text: reader.email }) : null,
    el('p', { class: 'sb-acct-muted', text: `Signed in from ${VIA_LABELS[reader.signed_in_via] ?? 'Sessionboard'}` }),
  ];
  const roles = [...reader.roles, ...(reader.staff ? ['staff'] : [])];
  if (roles.length) {
    nodes.push(
      el(
        'ul',
        { class: 'sb-acct-roles', 'aria-label': 'Your roles' },
        roles.map((r) => el('li', { text: r === 'staff' ? 'Sessionboard staff' : ROLE_LABELS[r] ?? r })),
      ),
    );
  }

  if (reader.organizations.length) {
    const orgSelect = el('select', { 'data-sb-org': '' }, [
      el('option', { value: '', text: 'Not personalized' }),
      ...reader.organizations.map((o) => el('option', { value: o.id, text: o.name })),
    ]);
    const eventSelect = el('select', { 'data-sb-event': '' });
    const fillEvents = () => {
      const org = reader.organizations.find((o) => o.id === orgSelect.value);
      eventSelect.replaceChildren(
        el('option', { value: '', text: org ? 'Whole organization' : '—' }),
        ...(org?.events ?? []).map((e) => el('option', { value: String(e.id), text: e.name })),
      );
      eventSelect.disabled = !org;
    };
    orgSelect.value = ctx?.orgId ?? '';
    fillEvents();
    eventSelect.value = ctx?.eventId != null ? String(ctx.eventId) : '';
    orgSelect.addEventListener('change', () => {
      fillEvents();
      onChoose(orgSelect.value ? { orgId: orgSelect.value, eventId: null } : null);
    });
    eventSelect.addEventListener('change', () =>
      onChoose({ orgId: orgSelect.value, eventId: eventSelect.value ? Number(eventSelect.value) : null }),
    );
    nodes.push(
      el('div', { class: 'sb-acct-section' }, [
        el('p', { class: 'sb-acct-muted', text: 'Read the Help Center for one of your events: steps that need a feature it does not have are folded away, and links open it in Sessionboard.' }),
        el('label', { text: 'Organization' }, [orgSelect]),
        el('label', { text: 'Event' }, [eventSelect]),
      ]),
    );
  }

  if (reader.portals.length) {
    nodes.push(
      el('div', { class: 'sb-acct-section' }, [
        el('p', { class: 'sb-acct-muted', text: 'Your portals' }),
        el(
          'ul',
          {},
          reader.portals.slice(0, 5).map((p) => el('li', { text: p.org_name ? `${p.event_name} (${p.org_name})` : p.event_name })),
        ),
      ]),
    );
  }

  const signOut = el('button', { type: 'button', text: 'Sign out of the Help Center' });
  signOut.addEventListener('click', async () => {
    try {
      await fetch('/_account/sign-out', { method: 'POST', credentials: 'same-origin' });
    } finally {
      writeJson('sessionStorage', READER_CACHE, null);
      location.reload();
    }
  });
  const openHref = ctx?.eventId
    ? `${reader.app_origin}/event/${ctx.eventId}/dashboard`
    : ctx?.orgId
      ? `${reader.app_origin}/org/${ctx.orgId}`
      : reader.app_origin;
  nodes.push(
    el('div', { class: 'sb-acct-actions' }, [el('a', { href: openHref, text: 'Open Sessionboard' }), signOut]),
  );
  return nodes;
}

function renderMenus(reader, ctx, onChoose) {
  for (const root of document.querySelectorAll('[data-sb-account]')) {
    const signIn = root.querySelector('[data-sb-account-signin]');
    const signedIn = root.querySelector('[data-sb-account-in]');
    if (!reader) {
      signIn.hidden = false;
      signedIn.hidden = true;
      continue;
    }
    signIn.hidden = true;
    signedIn.hidden = false;
    const avatar = root.querySelector('[data-sb-account-avatar]');
    if (reader.photo_url && /^https:\/\//.test(reader.photo_url)) {
      avatar.replaceChildren(el('img', { src: reader.photo_url, alt: '' }));
    } else {
      avatar.textContent = initials(reader);
    }
    root.querySelector('[data-sb-account-name]').textContent = reader.first_name || fullName(reader);
    root.querySelector('[data-sb-account-context]').textContent = ctx?.name ?? '';
    root.querySelector('[data-sb-account-panel]').replaceChildren(...buildPanel(reader, ctx, onChoose));
  }
}

function wireToggles() {
  for (const root of document.querySelectorAll('[data-sb-account]')) {
    const button = root.querySelector('[data-sb-account-toggle]');
    const panel = root.querySelector('[data-sb-account-panel]');
    const close = () => {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        button.focus();
      }
    });
  }
}

// ── Role-aware guides ──────────────────────────────────────────────────

function showForYou(reader) {
  const path = location.pathname.replace(/\/$/, '');
  for (const nav of document.querySelectorAll('[data-sb-for-you]')) {
    const sections = new Map([...nav.querySelectorAll('section[data-role]')].map((s) => [s.dataset.role, s]));
    let shown = 0;
    for (const role of reader.roles) {
      const section = sections.get(role);
      if (!section) continue;
      section.hidden = false;
      nav.append(section); // in role order: the one they signed in from first
      for (const a of section.querySelectorAll('a')) if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page');
      shown += 1;
    }
    nav.hidden = shown === 0;
  }
}

/** On an article written for another audience, say so once, above the content. */
function audienceNote(reader) {
  const lead = reader.roles[0];
  if (!lead || lead === 'organizer') return;
  const meta = document.querySelector('meta[name="sb-audience"]');
  const root = document.querySelector('.sl-markdown-content');
  if (!meta || !root || document.querySelector('[data-sb-audience-note]')) return;
  const audience = meta.content.split(',');
  const path = location.pathname.replace(/\/$/, '');
  const ownGuide = [...document.querySelectorAll(`[data-sb-for-you] section[data-role="${lead}"] a`)].some(
    (a) => a.getAttribute('href') === path,
  );
  if (ownGuide || audience.includes(AUDIENCE_BY_ROLE[lead])) return;
  const note = el('aside', { class: 'starlight-aside starlight-aside--note', 'data-sb-audience-note': '' }, [
    el('p', {
      class: 'starlight-aside__content',
      text: `You signed in from ${VIA_LABELS[reader.signed_in_via] ?? 'Sessionboard'}. This guide is written for event organizers; the guides for you are under “For you” in the sidebar.`,
    }),
  ]);
  root.prepend(note);
}

// ── Boot ───────────────────────────────────────────────────────────────

async function boot() {
  wireToggles();
  const reader = await loadReader();
  let ctx = reader ? savedContext(reader) : null;

  const choose = (choice) => {
    if (!choice) {
      ctx = null;
      writeJson('localStorage', CONTEXT_KEY, null);
    } else {
      const org = reader.organizations.find((o) => o.id === choice.orgId);
      const event = org?.events.find((e) => e.id === choice.eventId);
      ctx = { orgId: org.id, eventId: event ? event.id : null, name: event ? event.name : org.name };
      writeJson('localStorage', CONTEXT_KEY, { orgId: ctx.orgId, eventId: ctx.eventId });
    }
    renderMenus(reader, ctx, choose);
    applyContext(reader, ctx);
  };

  renderMenus(reader, ctx, choose);
  if (!reader) return;
  showForYou(reader);
  audienceNote(reader);
  if (ctx) applyContext(reader, ctx);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
