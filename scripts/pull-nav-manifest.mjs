#!/usr/bin/env node
/**
 * Refresh src/data/nav-manifest.json from sessionboard-web-api.
 *
 * The sidebar article names real modules and real links, and both are decided in
 * `services/utils/navigation/org-layout.js` and `event-layout.js` — files nobody
 * editing them has a reason to think about the Help Center for. A sidebar
 * article that lists a module we renamed, or omits a link we shipped, sends the
 * reader looking for something that is not there, which is worse than saying
 * nothing.
 *
 * So the manifest is committed here and `npm run nav:check` fails the build when
 * the article stops covering it. This script is how it gets refreshed, and the
 * exporter drops super-user-only links, so nothing internal can reach the
 * corpus through it.
 *
 * Deliberately writes no timestamp — a generated-at field would make every pull
 * a diff for no information.
 *
 * Usage:
 *   npm run nav:pull
 *   SB_WEB_API_DIR=… npm run nav:pull
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(DOCS_ROOT, '..');

const WEB_API_DIR = process.env.SB_WEB_API_DIR ?? join(WORKSPACE, 'sessionboard-web-api');
const OUT = join(DOCS_ROOT, 'src', 'data', 'nav-manifest.json');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const script = join(WEB_API_DIR, 'scripts', 'export-nav-manifest.js');
if (!existsSync(script)) {
  fail(
    `Cannot find ${script}.\n` +
      '  Check out sessionboard-web-api beside this repo, or set SB_WEB_API_DIR.',
  );
}

let stdout;
try {
  stdout = execFileSync(process.execPath, [script], {
    cwd: WEB_API_DIR,
    env: { ...process.env, NODE_PATH: '.' },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (err) {
  fail(
    `export-nav-manifest.js failed in ${WEB_API_DIR}.\n` +
      '  It exits non-zero when a layout names a link id the nav handlers no longer define —\n' +
      '  that is a product bug to fix there, not something to work around here.\n' +
      `  ${err.stderr || err.message}`,
  );
}

const manifest = JSON.parse(stdout);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);

const count = (scope) =>
  manifest[scope].modules.reduce(
    (sum, mod) => sum + mod.sections.reduce((n, s) => n + s.items.length, 0),
    0,
  );

console.log(
  `Wrote ${OUT}\n` +
    `  org:   ${manifest.org.modules.length} modules, ${count('org')} links\n` +
    `  event: ${manifest.event.modules.length} modules, ${count('event')} links\n` +
    '\nNow run `npm run nav:check` — it will tell you what the sidebar article is missing.',
);
