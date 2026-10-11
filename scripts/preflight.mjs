#!/usr/bin/env node
// Run the Docs CI "build" job locally, step for step, from the workflow file.
//
// The steps are read from .github/workflows/docs-ci.yml rather than listed here
// a second time, so a check added to CI is enforced before the next push
// without anyone remembering to mirror it. Steps that only make sense on a
// runner (`uses:` actions, `npm ci`) are skipped.
//
//   node scripts/preflight.mjs            # the working tree
//   node scripts/preflight.mjs --cwd DIR  # another checkout (the pre-push hook
//                                         # points this at the commit being pushed)
//
// Exit code is non-zero on the first failing step, naming it the way the
// GitHub UI does so the two reports read the same.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';

const args = process.argv.slice(2);
const cwdIdx = args.indexOf('--cwd');
const cwd = resolve(cwdIdx === -1 ? process.cwd() : args[cwdIdx + 1]);

const workflow = parse(readFileSync(join(cwd, '.github/workflows/docs-ci.yml'), 'utf8'));
const steps = (workflow.jobs?.build?.steps ?? []).filter(
  (s) => typeof s.run === 'string' && s.run.trim() !== 'npm ci',
);
if (steps.length === 0) {
  console.error('preflight: no runnable steps found in jobs.build of docs-ci.yml');
  process.exit(2);
}

const started = Date.now();
for (const step of steps) {
  const name = step.name ?? step.run.trim().split('\n')[0];
  const t = Date.now();
  process.stdout.write(`▶ ${name}\n`);
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status === 0) {
    process.stdout.write(`  ✓ ${secs}s\n`);
    continue;
  }
  // Only the failing step's output is shown; the passing ones were noise.
  process.stdout.write(r.stdout.toString());
  process.stderr.write(r.stderr.toString());
  console.error(`\n✖ Docs CI step failed: "${name}" (${secs}s)`);
  console.error(`  This is the same check that fails the push on main. Fix it, commit, push again.`);
  process.exit(r.status ?? 1);
}
console.log(`\n✓ All ${steps.length} Docs CI steps passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
