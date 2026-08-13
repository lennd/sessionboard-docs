/**
 * Rewrites `app:` links into route markers.
 *
 *   [Open the form builder](app:EventSessionForms)
 *     → <a data-sb-route="EventSessionForms" class="sb-app-link">Open the form builder</a>
 *
 * Why a link scheme rather than an <AppLink> component: it works inline
 * mid-sentence and inside tables, where JSX is awkward, and authors already
 * know how to write a markdown link. STYLE.md mandates relative links for docs
 * pages; this is the same muscle memory for product pages.
 *
 * No href is emitted. Every target in the manifest needs an event or org id,
 * and this repo cannot know either — a guessed `/event/123/sessions` would be
 * someone else's event. The in-app reader resolves the id against the event the
 * reader is actually in and turns it back into a real link; on the public site
 * it stays labelled text, so a signed-out reader is never handed a dead link.
 *
 * Unknown ids throw at build time. A stale route id renders as a dead button
 * inside the product, and published MDX cannot be fixed by a frontend deploy,
 * so this has to fail the build rather than warn.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'product-contract.json'), 'utf8'),
);

const APP_SCHEME = /^app:(.+)$/;

/** Depth-first walk over hast element nodes. */
function visitElements(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'element') fn(node);
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) visitElements(child, fn);
}

function hasVisibleText(node) {
  if (!node) return false;
  if (node.type === 'text') return node.value.trim().length > 0;
  if (!Array.isArray(node.children)) return false;
  return node.children.some(hasVisibleText);
}

export default function rehypeAppLinks() {
  return (tree, file) => {
    const where = file?.path ?? 'unknown file';
    const unknown = [];

    visitElements(tree, (node) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      const match = APP_SCHEME.exec(href);
      if (!match) return;

      const id = match[1].trim();
      const target = contract.appRoutes[id];
      if (!target) {
        unknown.push(id);
        return;
      }

      delete node.properties.href;
      node.properties['data-sb-route'] = id;
      node.properties.className = [
        ...(Array.isArray(node.properties.className) ? node.properties.className : []),
        'sb-app-link',
      ];

      // An author who wrote `[](app:EventSessions)` gets the manifest's label
      // rather than an empty link.
      if (!hasVisibleText(node)) {
        node.children = [{ type: 'text', value: target.label }];
      }
    });

    if (unknown.length > 0) {
      throw new Error(
        `${where}: unknown app: link target(s): ${[...new Set(unknown)].join(', ')}\n` +
          '  Valid ids live in src/data/product-contract.json under "appRoutes".\n' +
          '  Add the route to sessionboard-web-ui-v2/src/lib/appRoutes.json, then run\n' +
          '  `npm run contract:pull` here and commit the result.',
      );
    }
  };
}
