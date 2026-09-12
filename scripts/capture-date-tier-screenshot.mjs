/**
 * Capture the Date & Time Tiers pricing editor for the Help Center
 * (awards-pricing-payments-invoices.mdx, SB-7452).
 *
 * Tokens: export access_token/id_token/refresh_token from the logged-in
 * Chrome tab on :8080 into /tmp/sb-shot-tokens.json (do not commit that
 * file), then run:  node scripts/capture-date-tier-screenshot.mjs
 *
 * Uses the v2 session form editor's Payments & Fees step on local dev.
 * All tier edits stay client-side — the script never clicks Save/Next
 * after configuring tiers, so nothing persists.
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/images/kb');
const APP = 'http://localhost:8080';
// Any v2 form works; this is "Josh's Abstract Form" on the local seed event 4190.
const FORM_URL = `${APP}/event/4190/sessions/forms/715b8804-38da-4541-b351-d8b52ffd9516`;

const tokens = JSON.parse(await readFile('/tmp/sb-shot-tokens.json', 'utf8'));
if (!tokens.access_token) throw new Error('No access_token in /tmp/sb-shot-tokens.json');

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
});
await page.addInitScript((t) => {
  localStorage.setItem('access_token', t.access_token);
  if (t.id_token) localStorage.setItem('id_token', t.id_token);
  if (t.refresh_token) localStorage.setItem('refresh_token', t.refresh_token);
}, tokens);

await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForSelector('main h2', { timeout: 30000 });
} catch (e) {
  await page.screenshot({ path: '/tmp/date-tier-debug.png' });
  console.error('Page state at failure saved to /tmp/date-tier-debug.png; title:', await page.title());
  throw e;
}

// Walk the wizard forward to Payments & Fees (steps must be reached via Next).
// DOM-driven: the same approach verified interactively against this editor.
const reached = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 6; i++) {
    const h2 = document.querySelector('main h2')?.textContent ?? '';
    if (/Payments & Fees/.test(h2)) return h2;
    const next = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Next' && !b.disabled,
    );
    if (!next) return `no-next at "${h2}"`;
    next.click();
    await sleep(1800);
  }
  return document.querySelector('main h2')?.textContent ?? 'unknown';
});
if (!/Payments & Fees/.test(reached)) throw new Error(`Did not reach Payments step: ${reached}`);

// Switch the Date & Time Tiers mode to Sequential windows.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trigger = [
    ...document.querySelectorAll('main [role=combobox], main button[aria-haspopup="listbox"]'),
  ].find((b) => b.textContent.includes('Off — base fee only'));
  if (!trigger) throw new Error('mode select not found');
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  trigger.click();
  await sleep(800);
  const opt = [...document.querySelectorAll('[role=option]')].find((o) =>
    o.textContent.includes('Sequential windows'),
  );
  if (!opt) throw new Error('windows option not found');
  opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  opt.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  opt.click();
  await sleep(1200);
  const add = [...document.querySelectorAll('main button')].find(
    (b) => b.textContent.trim() === 'Add Tier',
  );
  add.click();
  await sleep(600);
  const add2 = [...document.querySelectorAll('main button')].find(
    (b) => b.textContent.trim() === 'Add Tier',
  );
  add2.click();
  await sleep(600);
});

// Fill each tier row by scoping to the row that owns each label input,
// using the native setter so React registers the change.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tiers = [
    { label: 'Early bird', price: '50', start: '2026-01-05T00:00', end: '2026-03-01T00:00' },
    { label: 'Regular', price: '75', start: '2026-03-01T00:00', end: '2026-04-30T23:59' },
  ];
  const labelInputs = [...document.querySelectorAll('main input[placeholder*="Early bird"]')];
  labelInputs.forEach((labelInput, i) => {
    const t = tiers[i];
    if (!t) return;
    // Row container: ancestor holding both a number and two datetime inputs.
    let row = labelInput;
    while (row && !(row.querySelector('input[type="number"]') && row.querySelectorAll('input[type="datetime-local"]').length >= 2)) {
      row = row.parentElement;
    }
    setVal(labelInput, t.label);
    setVal(row.querySelector('input[type="number"]'), t.price);
    const dts = row.querySelectorAll('input[type="datetime-local"]');
    setVal(dts[0], t.start);
    setVal(dts[1], t.end);
  });
  await sleep(1200);
});

// Clip the whole Date & Time Tiers card: smallest ancestor of the heading
// that also contains the Add Tier button.
const rect = await page.evaluate(() => {
  const heading = [...document.querySelectorAll('main *')].find(
    (e) => e.textContent.trim() === 'Date & Time Tiers' && e.children.length === 0,
  );
  if (!heading) return null;
  let node = heading;
  while (node && node !== document.body) {
    if ([...node.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add Tier')) {
      node.scrollIntoView({ block: 'center' });
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    node = node.parentElement;
  }
  return null;
});
if (!rect) throw new Error('Date & Time Tiers card not found');
await page.waitForTimeout(600);
// Re-read after the scroll settled.
const rect2 = await page.evaluate(() => {
  const heading = [...document.querySelectorAll('main *')].find(
    (e) => e.textContent.trim() === 'Date & Time Tiers' && e.children.length === 0,
  );
  let node = heading;
  while (node && node !== document.body) {
    if ([...node.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add Tier')) {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    node = node.parentElement;
  }
  return null;
});
await page.screenshot({
  path: path.join(OUT, 'date-tier-pricing-editor.png'),
  clip: rect2 ?? rect,
});

console.log('Wrote', path.join(OUT, 'date-tier-pricing-editor.png'));
await browser.close();
