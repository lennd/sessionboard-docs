#!/usr/bin/env node
/**
 * One-off: tag `features` on articles whose feature flag is unambiguous, so the
 * Availability box (src/components/Availability.astro) renders for them.
 *
 * Deliberately conservative. `features` also drives Team Lead retrieval
 * filtering and the in-app "does this apply to you" banner, so a wrong tag
 * tells a paying customer they lack something. Only files listed here are
 * touched, and only when they have no `features` line yet. Re-runnable.
 *
 *   node scripts/add-availability.mjs            # apply
 *   node scripts/add-availability.mjs --dry-run  # report
 */

import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const contract = JSON.parse(readFileSync('src/data/product-contract.json', 'utf8'));

/** article path (under src/content/docs) → feature slugs, plus optional frontmatter extras. */
const TAGS = {
  'automations/overview': { features: ['automations'] },
  'communications/add-on-custom-email-domain': { features: ['custom_sending_domain'] },
  'settings/domains': { features: ['custom_sending_domain'], enable_path: 'Settings → Domains' },
  'communications/email-campaigns': { features: ['email_campaigns'] },
  'communications/notifications': { features: ['notifications'] },
  'settings/field-rules': { features: ['field_rules'] },
  'settings/language-translation-variant': { features: ['languages'] },
  'integrations/sso': { features: ['sso'] },
  'settings/portal-login-methods': { features: ['sso'] },
  'integrations/webhooks': { features: ['webhooks'] },
  'events/portfolios': { features: ['portfolios'] },
  'reporting/report-builder': { features: ['ai_reports'] },
  'reporting/dashboards': { features: ['ai_reports'] },
  'reporting/dashboard-views': { features: ['ai_reports'] },
  'reporting/custom-reports': { features: ['ai_reports'] },
  'site/program-site': { features: ['customizations'] },
  'site/site-builder': { features: ['customizations'] },
  'site/publishing-surfaces': { features: ['customizations'] },
  'help/community': { features: ['community'] },
  'agents/coordinator': { features: ['coordinators'] },
  'agents/coordinator-run-history': { features: ['coordinators'] },
};

let changed = 0;
for (const [path, extra] of Object.entries(TAGS)) {
  const file = `src/content/docs/${path}.mdx`;
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.log(`  skip  ${path} (no such article)`);
    continue;
  }
  for (const f of extra.features) if (!contract.features.includes(f)) throw new Error(`${path}: ${f} is not in the contract`);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`${path}: no frontmatter`);
  if (/^features:/m.test(m[1])) {
    console.log(`  keep  ${path} (already tagged)`);
    continue;
  }
  const lines = [`features: [${extra.features.map((f) => `"${f}"`).join(', ')}]`];
  if (extra.enable_path) lines.push(`enable_path: "${extra.enable_path}"`);
  const fm = `${m[1]}\n${lines.join('\n')}`;
  const out = `---\n${fm}\n---\n${src.slice(m[0].length)}`;
  changed += 1;
  console.log(`  ${DRY ? 'would' : 'tag  '} ${path} ← ${extra.features.join(', ')}`);
  if (!DRY) writeFileSync(file, out);
}
console.log(`${DRY ? 'Would tag' : 'Tagged'} ${changed} article(s).`);
