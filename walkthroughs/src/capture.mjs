// PRODUCTION capture: drive the authenticated Sessionboard app through the spec
// and record a .webm, dwelling on each step for its narration duration.
// Requires SB_APP_URL + SB_AUTH_STORAGE (Playwright storage-state from the E2E harness).
import { chromium } from 'playwright';

const CURSOR = `
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(30,98,216,.35);border:2px solid #1E62D8;pointer-events:none;transition:all .4s cubic-bezier(.22,1,.36,1)';
  document.body.appendChild(c); window.__cur = c;
  document.addEventListener('mousemove', e => { c.style.left = e.clientX+'px'; c.style.top = e.clientY+'px'; }, true);
`;

export async function capture(spec, steps, outDir) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    storageState: process.env.SB_AUTH_STORAGE,
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  await page.goto(process.env.SB_APP_URL, { waitUntil: 'networkidle' });
  await page.addInitScript(CURSOR); await page.evaluate(CURSOR);

  for (const st of steps) {
    const a = st.action || {};
    try {
      if (st.highlight) await outline(page, st.highlight);
      if (a.selector) await moveCursorTo(page, a.selector);
      if (a.type === 'click') await page.click(a.selector, { timeout: 5000 });
      else if (a.type === 'fill') await page.fill(a.selector, a.value ?? '', { timeout: 5000 });
      else if (a.type === 'navigate') await page.goto(a.value, { waitUntil: 'networkidle' });
    } catch (e) { console.warn(`step "${st.narration.slice(0,40)}...": ${e.message}`); }
    await page.waitForTimeout(Math.max(1200, st.duration * 1000)); // dwell = narration length
  }
  const video = page.video();
  await ctx.close(); await browser.close();
  return video.path();
}

async function moveCursorTo(page, sel) {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
}
async function outline(page, sel) {
  await page.evaluate((s) => {
    document.querySelectorAll('[data-sb-hl]').forEach(e => { e.style.outline=''; e.removeAttribute('data-sb-hl'); });
    const el = document.querySelector(s); if (!el) return;
    el.setAttribute('data-sb-hl','1'); el.scrollIntoView({ block:'center', behavior:'smooth' });
    el.style.outline = '3px solid #1E62D8'; el.style.outlineOffset = '3px'; el.style.borderRadius = '8px';
  }, sel).catch(() => {});
}
