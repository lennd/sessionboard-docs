#!/usr/bin/env node
/**
 * Generate src/breadcrumbs.json: slug → { trail, section }
 *
 * trail  = [{ label, href|null }, ...] from the sidebar hierarchy (tab → groups).
 *          Group crumbs link to the group's first page so every crumb is a real URL
 *          (required for valid BreadcrumbList structured data).
 * section = the innermost group label — used as the OG-image eyebrow.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const sidebar = JSON.parse(readFileSync(new URL('../src/sidebar.json', import.meta.url), 'utf8'));

const out = {};

function firstSlug(node) {
  if (node.slug) return node.slug;
  for (const item of node.items ?? []) {
    const s = firstSlug(item);
    if (s) return s;
  }
  return null;
}

function walk(items, ancestors) {
  for (const item of items) {
    if (item.slug) {
      out[item.slug] = {
        trail: ancestors.map((a) => ({ label: a.label, href: a.href })),
        section: ancestors.length ? ancestors[ancestors.length - 1].label : null,
      };
    } else if (item.items) {
      const first = firstSlug(item);
      walk(item.items, [...ancestors, { label: item.label, href: first ? `/${first}` : null }]);
    }
  }
}

for (const tab of sidebar) {
  const first = firstSlug(tab);
  walk(tab.items ?? [], [{ label: tab.label, href: first ? `/${first}` : null }]);
}

writeFileSync(new URL('../src/breadcrumbs.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote src/breadcrumbs.json (${Object.keys(out).length} pages)`);
