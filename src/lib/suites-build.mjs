/**
 * Keeps an unreleased suite's static files out of the build.
 *
 * Pages of a suite that is not built never exist (content.config.ts drops
 * them), but Astro copies public/ into dist/ verbatim, so a suite's
 * screenshots (public/images/suites/<key>/) and share images
 * (public/og/sessionboard-<key>--*.png) would still be served from the live
 * Help Center before the product ships. This integration deletes them from
 * dist/ after the build, using the same release filter (builtSuites) as the
 * content loader, the help index and the head script.
 *
 * Node only: imported by astro.config.mjs and the tests, never by a page.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM, builtSuites } from './suites.mjs';

/** dist-relative paths of every static file that belongs to a suite not in `built`. */
export function unbuiltSuiteFiles(distDir, config, built) {
  const out = [];
  for (const key of Object.keys(config.suites)) {
    if (key === PLATFORM || built.has(key)) continue;
    const root = config.suites[key].path.replace(/^\//, ''); // "sessionboard-awards"
    const images = join(distDir, 'images', 'suites', key);
    if (existsSync(images)) out.push(`images/suites/${key}`);
    const og = join(distDir, 'og');
    if (existsSync(og)) {
      for (const name of readdirSync(og)) if (name.startsWith(`${root}--`) || name === `${root}.png`) out.push(`og/${name}`);
    }
  }
  return out.sort();
}

/** Astro integration: after the build, remove unreleased suites' static files from dist/. */
export function suiteStaticFiles(config, env = process.env) {
  return {
    name: 'sb-suite-static-files',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const files = unbuiltSuiteFiles(distDir, config, builtSuites(config, env));
        for (const rel of files) rmSync(join(distDir, rel), { recursive: true, force: true });
        if (files.length) logger.info(`removed ${files.length} static file(s) of unreleased suites`);
      },
    },
  };
}
