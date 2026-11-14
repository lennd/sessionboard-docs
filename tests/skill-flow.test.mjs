import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { OUTCOMES, flowFor } from '../src/lib/skill-flow.mjs';
import { SKILL_PRODUCTS } from '../src/lib/skills.mjs';

const manifest = JSON.parse(readFileSync(new URL('../public/skills/downloads/skills.json', import.meta.url), 'utf8'));

test('every product group has an outcome drawing', () => {
  for (const p of SKILL_PRODUCTS) assert.ok(OUTCOMES[p.key], p.key);
});

test('every skill gets an ask and steps; changes wait for your OK first', () => {
  for (const skill of manifest.skills) {
    const { ask, steps } = flowFor(skill);
    assert.ok(ask.length > 0 && ask.length <= 111, `${skill.id} ask`);
    assert.ok(steps.length >= 1, `${skill.id} steps`);
    const writes = skill.tools.some((t) => t.access !== 'read');
    const wait = steps.findIndex((s) => s.kind === 'wait');
    if (writes) assert.equal(steps[wait + 1]?.kind, 'next', `${skill.id} change after OK`);
    else assert.equal(wait, -1, `${skill.id} reads only`);
  }
});

test('"Skills for" views name real groups, and every self-serve view has skills', async () => {
  const { SKILLS_FOR, skillsFor, skillsByProduct } = await import('../src/lib/skills.mjs');
  const groups = new Set(skillsByProduct().map((g) => g.key));
  for (const [product, keys] of Object.entries(SKILLS_FOR)) {
    for (const k of keys) assert.ok(SKILL_PRODUCTS.some((p) => p.key === k), `${product} → ${k}`);
    assert.ok(skillsFor(product).some((k) => groups.has(k)), `${product} has skills`);
  }
  assert.equal(skillsFor('platform').length, SKILL_PRODUCTS.length);
});
