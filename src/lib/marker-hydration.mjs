/**
 * Marker hydration — the one implementation of the personalization spec.
 *
 * Help Center MDX declares SEMANTICS ("this block needs the awards feature");
 * the surface rendering it decides BEHAVIOUR ("Awards isn't enabled for Acme
 * Summit — turn it on"). This module is that decision, and it runs unchanged
 * on three surfaces:
 *
 *   1. the in-product reader (real entitlements from the event),
 *   2. learn.sessionboard.com signed out (reader self-selects),
 *   3. learn.sessionboard.com signed in (auto-detected).
 *
 * It is plain DOM, dependency-free, and framework-free precisely so the
 * product repo can vendor this exact file instead of maintaining a port that
 * drifts. See MARKER_SPEC.md for the authoring contract and
 * tests/fixtures/marker-hydration.json for the shared corpus both copies run.
 *
 * Four invariants. All four are load-bearing, not stylistic:
 *
 *   NEVER REMOVE CONTENT.  Unmet blocks are collapsed, never deleted. The text
 *     stays in the DOM so it stays crawlable and citable, so support can screen
 *     -share the same article, and so readers still discover what they could
 *     have. This is the whole reason personalizing a public page costs no SEO.
 *
 *   UNKNOWN MEANS VISIBLE.  If we cannot evaluate a condition — no context
 *     loaded, or the feature lives on a scope we have no data for — the block
 *     renders normally. Telling a customer they lack a feature they paid for is
 *     far worse than showing one paragraph too many.
 *
 *   IDEMPOTENT.  Re-running on the same subtree (React re-render, context
 *     change, island rehydrate) must converge, not nest wrappers.
 *
 *   READ ATTRIBUTES, EVALUATE NOTHING.  This walks `data-sb-*` values. It
 *     never evaluates a string from the document, so a compromised article
 *     cannot become script execution.
 */

/**
 * Bumped when the ATTRIBUTE VOCABULARY or hydration behaviour changes.
 * The fixture corpus records the version it was written for; a vendored copy
 * claiming a different version fails its parity test rather than silently
 * rendering the old semantics.
 */
export const MARKER_SPEC_VERSION = 1;

const ATTR = {
  feature: 'data-sb-feature',
  setting: 'data-sb-setting',
  route: 'data-sb-route',
  addon: 'data-sb-addon',
  state: 'data-sb-state',
  reason: 'data-sb-reason',
};

/** Marks a wrapper this module created, so re-runs reuse it. */
const COLLAPSE_ATTR = 'data-sb-collapse';

const SELECTOR = `[${ATTR.feature}],[${ATTR.setting}],[${ATTR.route}],[${ATTR.addon}]`;

const tokens = (value) =>
  String(value || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

/** "enable_speaker_acceptance" → "Speaker acceptance". */
export function settingLabel(id) {
  const words = String(id || '')
    .replace(/^flag_enable_/, '')
    .replace(/^enable_/, '')
    .split('_')
    .filter(Boolean);
  if (words.length === 0) return String(id || '');
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

export function featureLabel(slug, contract) {
  return contract?.featureNames?.[slug] || settingLabel(slug);
}

/**
 * Evaluate one feature slug against the context.
 *
 * A slug can live on the event registry, the org registry, or both; "both"
 * means either satisfies it, which is what an author means by "they have
 * Marketing". Returns 'met' | 'unmet' | 'unknown'.
 */
function evaluateFeature(slug, context) {
  const contract = context.contract || {};
  const scopes = contract.featureScopes?.[slug];
  // A slug absent from the contract is a docs bug that the build should have
  // caught. At runtime, fail open rather than hide content.
  if (!scopes || scopes.length === 0) return 'unknown';

  let sawData = false;
  for (const scope of scopes) {
    const enabled = context.features?.[scope];
    if (!Array.isArray(enabled)) continue;
    sawData = true;
    const resolvedId = contract.featureIdBySlug?.[scope]?.[slug] ?? slug;
    if (enabled.includes(resolvedId)) return 'met';
  }
  return sawData ? 'unmet' : 'unknown';
}

/** Returns 'met' | 'unmet' | 'unknown' for one setting id. */
function evaluateSetting(id, context) {
  const settings = context.settings;
  if (!settings || typeof settings !== 'object') return 'unknown';
  if (!(id in settings)) return 'unknown';
  return settings[id] === true ? 'met' : 'unmet';
}

/**
 * Combine per-token results. Every token must be met for the block to show
 * normally; a single unmet collapses it; otherwise unknown wins (fail open).
 */
function combine(results) {
  if (results.length === 0) return 'unknown';
  if (results.some((r) => r.state === 'unmet')) return 'unmet';
  if (results.every((r) => r.state === 'met')) return 'met';
  return 'unknown';
}

function unmetLabels(results, context) {
  return results
    .filter((r) => r.state === 'unmet')
    .map((r) =>
      r.kind === 'feature'
        ? featureLabel(r.token, context.contract)
        : settingLabel(r.token),
    );
}

/**
 * Human summary for something the reader is not entitled to, named after the
 * actual event so they know it is about them and not a generic caveat.
 *
 * Exported because the surface needs the same sentence for its own article-level
 * banner, which sits directly above blocks this produces the summary for. Two
 * formatters would read as two voices on one screen — and the naive version gets
 * the verb wrong the moment there are two labels ("Awards and Sessions isn't").
 */
export function unmetSummary(labels, context = {}) {
  if (!labels || labels.length === 0) return '';
  const subject =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const verb = labels.length === 1 ? "isn't" : "aren't";
  const scope = context.eventName ? ` for ${context.eventName}` : '';
  return `${subject} ${verb} enabled${scope}`;
}

/**
 * Wrap `el` in a collapsed disclosure, or update the wrapper from a previous
 * run. Content is moved, never dropped.
 */
function collapse(el, results, context) {
  const doc = el.ownerDocument;
  const labels = unmetLabels(results, context);
  const summaryText = unmetSummary(labels, context);

  const existing = el.parentElement;
  const reuse =
    existing && existing.hasAttribute && existing.hasAttribute(COLLAPSE_ATTR)
      ? existing
      : null;

  const details = reuse || doc.createElement('details');
  if (!reuse) {
    details.setAttribute(COLLAPSE_ATTR, '');
    details.className = 'sb-marker-collapsed';
    el.parentNode.insertBefore(details, el);
    details.appendChild(el);
  }

  let summary = details.querySelector(':scope > summary');
  if (!summary) {
    summary = doc.createElement('summary');
    details.insertBefore(summary, details.firstChild);
  }
  summary.textContent = summaryText;

  // A deep link to the thing that turns it on, when the surface can build one.
  const first = results.find((r) => r.state === 'unmet');
  const href =
    first &&
    (first.kind === 'feature'
      ? context.featureHref?.(first.token)
      : context.settingHref?.(first.token));
  let action = details.querySelector(':scope > [data-sb-enable]');
  if (href) {
    if (!action) {
      action = doc.createElement('a');
      action.setAttribute('data-sb-enable', '');
      action.className = 'sb-marker-enable';
      details.appendChild(action);
    }
    action.setAttribute('href', href);
    action.textContent =
      first.kind === 'feature' ? 'Ask about enabling this' : 'Open this setting';
  } else if (action) {
    // Context changed to one that cannot resolve a link — drop the link but
    // keep the node, so we never leave a dead href behind.
    action.removeAttribute('href');
  }

  return details;
}

/** Undo a collapse from a previous run, promoting the content back in place. */
function uncollapse(el) {
  const wrapper = el.parentElement;
  if (!wrapper || !wrapper.hasAttribute || !wrapper.hasAttribute(COLLAPSE_ATTR)) {
    return;
  }
  wrapper.parentNode.insertBefore(el, wrapper);
  wrapper.remove();
}

function hydrateConditional(el, context) {
  const results = [
    ...tokens(el.getAttribute(ATTR.feature)).map((token) => ({
      kind: 'feature',
      token,
      state: evaluateFeature(token, context),
    })),
    ...tokens(el.getAttribute(ATTR.setting)).map((token) => ({
      kind: 'setting',
      token,
      state: evaluateSetting(token, context),
    })),
  ];
  if (results.length === 0) return;

  const state = combine(results);
  el.setAttribute(ATTR.state, state);

  if (state === 'unmet') {
    const labels = unmetLabels(results, context);
    el.setAttribute(ATTR.reason, labels.join(', '));
    collapse(el, results, context);
  } else {
    el.removeAttribute(ATTR.reason);
    uncollapse(el);
  }
}

/**
 * Resolve an `app:` link to this reader's own event, or degrade to plain text.
 *
 * The anchor is kept either way — stripping the href rather than replacing the
 * node keeps the sentence intact and honours "never remove content".
 */
function hydrateRoute(el, context) {
  const id = el.getAttribute(ATTR.route);
  const href = context.resolveRoute?.(id) ?? null;

  if (href) {
    el.setAttribute('href', href);
    el.setAttribute(ATTR.state, 'resolved');
    return;
  }

  el.removeAttribute('href');
  el.setAttribute(ATTR.state, 'unresolved');
  // Only supply fallback text when the author left the label empty; an
  // author-written label always wins.
  if (!el.textContent || !el.textContent.trim()) {
    const label = context.routeLabel?.(id);
    if (label) el.textContent = label;
  }
}

/**
 * Re-point an add-on callout at the reader's own event.
 *
 * On the public site the component already rendered "contact support to enable
 * this". In-product we know whether they have it, so a customer who already
 * owns Awards should not be told to contact support about Awards.
 */
function hydrateAddon(el, context) {
  const slug = el.getAttribute(ATTR.addon);
  const state = evaluateFeature(slug, context);
  el.setAttribute(ATTR.state, state);
  if (state !== 'unmet' && state !== 'met') return;

  const body = el.querySelector('[data-sb-addon-body]');
  if (!body) return;

  const name = featureLabel(slug, context.contract);
  if (state === 'met') {
    body.textContent = context.eventName
      ? `${name} is enabled for ${context.eventName}.`
      : `${name} is enabled.`;
    return;
  }
  body.textContent = context.eventName
    ? `${name} isn't enabled for ${context.eventName}.`
    : `${name} isn't enabled for your organization.`;
}

/**
 * Hydrate every marker under `root`.
 *
 * @param {Element} root - subtree containing rendered article HTML.
 * @param {object} context - see the module comment; every field optional, and
 *   an empty context is valid and means "leave everything visible".
 * @returns {{hydrated: number, specVersion: number}}
 */
export function hydrateMarkers(root, context = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return { hydrated: 0, specVersion: MARKER_SPEC_VERSION };
  }

  // Snapshot first: collapsing mutates the tree around the nodes we are
  // walking, and a live list would skip or revisit siblings.
  const elements = Array.from(root.querySelectorAll(SELECTOR));
  let hydrated = 0;

  for (const el of elements) {
    if (el.hasAttribute(ATTR.route)) {
      hydrateRoute(el, context);
      hydrated += 1;
      continue;
    }
    if (el.hasAttribute(ATTR.addon)) {
      hydrateAddon(el, context);
      hydrated += 1;
      continue;
    }
    hydrateConditional(el, context);
    hydrated += 1;
  }

  root.setAttribute?.('data-sb-hydrated', String(MARKER_SPEC_VERSION));
  return { hydrated, specVersion: MARKER_SPEC_VERSION };
}

/**
 * Article-level applicability from `features:` frontmatter.
 *
 * This is what gives all 227 pages a correct "does this apply to me" signal
 * the moment the taxonomy lands, before anyone annotates a single block.
 */
export function articleApplicability(features, context = {}) {
  const list = Array.isArray(features) ? features.filter(Boolean) : [];
  if (list.length === 0) return { state: 'met', missing: [] };

  const results = list.map((token) => ({
    kind: 'feature',
    token,
    state: evaluateFeature(token, context),
  }));

  return {
    state: combine(results),
    missing: unmetLabels(results, context),
  };
}

export const MARKER_ATTRIBUTES = ATTR;
