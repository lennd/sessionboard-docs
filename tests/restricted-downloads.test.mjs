import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import site from '../site.json' with { type: 'json' };
import { isSignedInOnlyPath, isStaffOnlyPath, isStaffTierPath } from '../src/lib/staff-only.mjs';
import { buildMap } from '../scripts/build-restricted-assets.mjs';
import { filterZip, hiddenSkills, zipNames } from '../scripts/build-skill-downloads.mjs';

test('screenshots of restricted pages take their tier; shared ones stay public', () => {
  assert.equal(isStaffTierPath('/images/kb/registration-form-editor-details.png', site), true);
  assert.equal(isSignedInOnlyPath('/images/kb/field-events-checkin-links.png', site), true);
  assert.equal(isStaffOnlyPath('/images/kb/field-rules-dialog.png', site), false);
});

test('the committed restricted-assets map is current', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../src/data/restricted-assets.json', import.meta.url), 'utf8')), buildMap());
});

test("a restricted skill's own ZIP takes its article's tier", () => {
  assert.equal(isStaffTierPath('/skills/downloads/answer-registration-questions.zip', site), true);
  assert.equal(isSignedInOnlyPath('/skills/downloads/event-performance-briefing.zip', site), true);
  assert.equal(isStaffOnlyPath('/skills/downloads/build-the-agenda.zip', site), false);
});

test('public bundles drop every restricted skill and the README lines naming them; signed-in ones only staff-only skills', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/skills/downloads/skills.json', import.meta.url), 'utf8'));
  const ids = manifest.skills.map((s) => s.id);
  const pub = hiddenSkills(ids, 'public');
  const member = hiddenSkills(ids, 'member');
  assert.ok(pub.has('event-performance-briefing') && pub.has('answer-registration-questions'));
  assert.ok(!member.has('event-performance-briefing') && member.has('answer-registration-questions'));

  const src = readFileSync(new URL('../public/skills/downloads/sessionboard-claude-plugin-us.zip', import.meta.url));
  const out = filterZip(src, {
    drop: (name) => name.split('/').some((seg) => pub.has(seg)),
    rewrite: (name, text) => (/readme\.md$/i.test(name) ? text.split('\n').filter((l) => ![...pub].some((id) => l.includes(`\`${id}\``))).join('\n') : null),
  });
  const names = zipNames(out);
  assert.ok(names.some((n) => n.includes('/build-the-agenda/')));
  assert.equal(names.some((n) => n.split('/').some((seg) => pub.has(seg))), false);
  assert.equal(zipNames(filterZip(src)).length, zipNames(src).length);
});
