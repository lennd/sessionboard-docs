#!/usr/bin/env node
/**
 * One-time (re-runnable) conversion of the legacy Mintlify docs.json navigation
 * into a Starlight sidebar config, written to src/sidebar.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const docs = JSON.parse(readFileSync(new URL('../docs.json', import.meta.url), 'utf8'));

function convertPages(pages) {
  const items = [];
  for (const page of pages) {
    if (typeof page === 'string') {
      if (page === 'index') continue; // home page is not a sidebar entry
      items.push({ slug: page });
    } else if (page.group) {
      items.push({ label: page.group, collapsed: true, items: convertPages(page.pages ?? []) });
    }
  }
  return items;
}

const sidebar = [];
for (const tab of docs.navigation.tabs) {
  const groups = (tab.groups ?? []).map((g) => ({
    label: g.group,
    collapsed: true,
    items: convertPages(g.pages ?? []),
  }));
  sidebar.push({ label: tab.tab, collapsed: false, items: groups });
}

writeFileSync(new URL('../src/sidebar.json', import.meta.url), JSON.stringify(sidebar, null, 2) + '\n');
console.log(`Wrote src/sidebar.json (${sidebar.length} top-level sections)`);
