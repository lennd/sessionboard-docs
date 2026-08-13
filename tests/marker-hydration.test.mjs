/**
 * Runs the shared corpus against the CANONICAL hydrator, here at its source.
 *
 * sessionboard-web-ui-v2 runs the same fixtures against its vendored copy, plus
 * a checksum test proving the copy is current. That catches drift — but only in
 * the product repo's CI, on a different pull request, hours or days after a docs
 * change broke it. This suite is the same corpus enforced where the code lives,
 * so `npm test` here fails before the copy is ever synced.
 *
 * linkedom rather than jsdom: the hydrator is deliberately plain DOM with no
 * layout, events, or navigation, and a docs repo should not pull a browser
 * emulator in to test it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { parseHTML } from 'linkedom';

import {
  MARKER_SPEC_VERSION,
  articleApplicability,
  hydrateMarkers,
  settingLabel,
  unmetSummary,
} from '../src/lib/marker-hydration.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(resolve(here, 'fixtures/marker-hydration.json'), 'utf8'),
);

const { document } = parseHTML('<!doctype html><html><body></body></html>');

/**
 * Fixtures stay declarative JSON, so link resolution is expressed as lookup
 * maps; the hydrator takes callbacks. Adapt here rather than putting functions
 * in a corpus two repos have to parse.
 */
const toContext = (raw = {}) => ({
  eventName: raw.eventName ?? null,
  features: raw.features ?? {},
  settings: raw.settings ?? null,
  contract: fixtures.contract,
  resolveRoute: (id) => raw.routes?.[id] ?? null,
  routeLabel: (id) => raw.routeLabels?.[id] ?? null,
  settingHref: () => raw.settingHref ?? null,
  featureHref: () => null,
});

const render = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

/**
 * Serialize a subtree with attributes sorted and whitespace-only text dropped.
 *
 * The corpus is shared with sessionboard-web-ui-v2, which runs it under jsdom,
 * and the two DOM implementations emit attributes in different orders. Comparing
 * raw `innerHTML` would make this suite fail on that alone, so compare what the
 * spec actually constrains: elements, attribute values, and text.
 */
const canonical = (node) => {
  if (node.nodeType === 3) return node.textContent?.trim() ?? '';
  if (node.nodeType !== 1) return '';
  const attrs = Array.from(node.attributes ?? [])
    .map((a) => `${a.name}="${a.value}"`)
    .sort()
    .join(' ');
  const children = Array.from(node.childNodes).map(canonical).filter(Boolean).join('');
  const tag = node.localName;
  return `<${tag}${attrs ? ` ${attrs}` : ''}>${children}</${tag}>`;
};

const canonicalChildren = (node) =>
  Array.from(node.childNodes).map(canonical).filter(Boolean).join('');

const canonicalHtml = (html) => canonicalChildren(render(html));

/** Every non-empty text node under `node`, in document order. */
const textNodes = (node, out = []) => {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = child.textContent?.trim();
      if (text) out.push(text);
    } else if (child.nodeType === 1) {
      textNodes(child, out);
    }
  }
  return out;
};

describe('marker hydration corpus', () => {
  test('the corpus and the implementation agree on the spec version', () => {
    assert.equal(fixtures.specVersion, MARKER_SPEC_VERSION);
  });

  for (const testCase of fixtures.cases) {
    test(testCase.name, () => {
      const host = render(testCase.input);
      hydrateMarkers(host, toContext(testCase.context));
      assert.equal(canonicalChildren(host), canonicalHtml(testCase.expected));
    });

    test(`is idempotent: ${testCase.name}`, () => {
      const host = render(testCase.input);
      const context = toContext(testCase.context);
      hydrateMarkers(host, context);
      const once = host.innerHTML;
      hydrateMarkers(host, context);
      hydrateMarkers(host, context);
      assert.equal(host.innerHTML, once);
    });
  }

  test('never drops author content, whatever the context', () => {
    // The invariant that makes personalizing a public page cost no SEO: an
    // unmet block is collapsed, never deleted. Scoped to pristine article HTML
    // — `data-sb-addon` substitutes its body by design, and an input that
    // already carries a `data-sb-collapse` wrapper contains our summary text,
    // which SHOULD disappear once the block is met.
    const conditional = fixtures.cases.filter(
      (c) => !c.input.includes('data-sb-addon') && !c.input.includes('data-sb-collapse'),
    );
    assert.ok(conditional.length > 0, 'corpus lost its conditional cases');

    for (const testCase of conditional) {
      const host = render(testCase.input);
      const before = textNodes(host);
      hydrateMarkers(host, toContext(testCase.context));
      const after = textNodes(host);
      for (const text of before) {
        assert.ok(after.includes(text), `"${text}" vanished in: ${testCase.name}`);
      }
    }
  });

  test('an unresolved app link keeps its sentence but loses its href', () => {
    const host = render('<a data-sb-route="EventSessionForms" href="#">builder</a>');
    hydrateMarkers(host, toContext({}));
    const anchor = host.querySelector('a');
    assert.equal(anchor.hasAttribute('href'), false);
    assert.equal(anchor.getAttribute('data-sb-state'), 'unresolved');
    assert.equal(anchor.textContent, 'builder');
  });
});

describe('articleApplicability', () => {
  for (const testCase of fixtures.applicabilityCases) {
    test(testCase.name, () => {
      assert.deepEqual(
        articleApplicability(testCase.features, toContext(testCase.context)),
        testCase.expected,
      );
    });
  }
});

describe('unmetSummary', () => {
  // The in-product reader reuses this for its article-level banner, which is why
  // it is exported at all. The plural verb is the reason it is not inlined there.
  const acme = { eventName: 'Acme Summit' };

  test('one label', () => {
    assert.equal(unmetSummary(['Awards'], acme), "Awards isn't enabled for Acme Summit");
  });

  test('two labels take a plural verb', () => {
    assert.equal(
      unmetSummary(['Awards', 'Sessions'], acme),
      "Awards and Sessions aren't enabled for Acme Summit",
    );
  });

  test('three labels read as a list', () => {
    assert.equal(
      unmetSummary(['Awards', 'Sessions', 'Marketing'], acme),
      "Awards, Sessions and Marketing aren't enabled for Acme Summit",
    );
  });

  test('omits the event when none is known', () => {
    assert.equal(unmetSummary(['Awards'], {}), "Awards isn't enabled");
  });

  test('is empty for nothing missing, rather than a dangling sentence', () => {
    assert.equal(unmetSummary([], acme), '');
  });
});

describe('settingLabel', () => {
  test('reads as prose rather than a column name', () => {
    assert.equal(settingLabel('enable_speaker_acceptance'), 'Speaker acceptance');
    assert.equal(settingLabel('flag_enable_webhooks'), 'Webhooks');
    assert.equal(settingLabel(''), '');
  });
});
