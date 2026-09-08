/**
 * Capture Help Center screenshots for LiveBuzz / Visit / Brella.
 *
 * Tokens: export them from the logged-in Chrome tab on :8080 into
 * /tmp/sb-shot-tokens.json (do not commit that file), then run this
 * against the worktree UI on :8081. Writes PNGs under public/images/kb/apps/.
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/images/kb/apps');
const CONNECTORS = path.join(
  __dirname,
  '../../.worktrees/apps-livebuzz-visit-brella-api/lib/apps-engine/examples',
);

const SRC = 'http://localhost:8080';
const DST = 'http://localhost:8081';
const ORG = '81b4f325-14ef-4407-83b0-ed726899abd5';
const EVENT = '4190';

const VENDORS = [
  {
    id: 'livebuzz',
    name: 'LiveBuzz',
    displayName: 'Clarion 2026',
    connector: 'livebuzz.connector.json',
  },
  {
    id: 'visit',
    name: 'Visit',
    displayName: 'Informa Expo 2026',
    connector: 'visit.connector.json',
  },
  {
    id: 'brella',
    name: 'Brella',
    displayName: 'FT Event 2026',
    connector: 'brella.connector.json',
  },
];

async function loadConnector(file) {
  const raw = JSON.parse(await readFile(path.join(CONNECTORS, file), 'utf8'));
  const fields = (raw.connection?.fields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: !!f.required,
    secret: !!f.secret,
    help: f.help,
    default: f.default,
  }));
  return {
    fields,
    syncSettings: raw.sync?.settings ?? [],
    entities: (raw.entities ?? []).map((e) => ({
      name: e.name,
      fields: (e.fields ?? []).map((f) => ({
        sessionboardField: f.sessionboardField,
        remoteField: f.remoteField,
        direction: f.direction,
        authority: f.authority,
      })),
    })),
  };
}

async function shot(page, name, locator) {
  const target = locator ?? page.locator('main').first();
  await target.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot({ path: file });
  console.log('wrote', file);
}

async function stealTokens() {
  const raw = await readFile('/tmp/sb-shot-tokens.json', 'utf8');
  const tokens = JSON.parse(raw);
  if (!tokens.access_token) {
    throw new Error('No access_token in /tmp/sb-shot-tokens.json');
  }
  return tokens;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const tokens = await stealTokens();

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t.access_token);
    if (t.id_token) localStorage.setItem('id_token', t.id_token);
    if (t.refresh_token) localStorage.setItem('refresh_token', t.refresh_token);
  }, tokens);

  // Catalog + setup CTAs hit the real API (fine). Install + connections are mocked
  // so we can show the new connect form without the old API knowing these catalogs.
  const mocks = new Map();
  for (const v of VENDORS) {
    mocks.set(v.id, await loadConnector(v.connector));
  }

  let connectionsMode = 'empty'; // empty | saved
  let activeVendor = 'livebuzz';

  await page.route('**/organizations/*/apps/install-catalog', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    const body = route.request().postDataJSON() || {};
    const catalogId = body.catalogId || activeVendor;
    const spec = mocks.get(catalogId) || mocks.get('livebuzz');
    const vendor = VENDORS.find((v) => v.id === catalogId) || VENDORS[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        app: {
          id: `shot-${catalogId}`,
          org_id: ORG,
          name: vendor.name,
          surfaces: ['connector'],
          status: 'published',
          tier: 'verified',
          scopes: ['program:read', 'contacts:read'],
          manifest: {
            name: vendor.name,
            surfaces: ['connector'],
            sync: { settings: spec.syncSettings },
            entities: spec.entities,
          },
        },
        connectionFields: spec.fields,
        oauthAuthorize: false,
      }),
    });
  });

  await page.route('**/organizations/*/apps/*/connections', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, body: '{}' });
    const vendor = VENDORS.find((v) => v.id === activeVendor) || VENDORS[0];
    if (connectionsMode === 'empty') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: `conn-${activeVendor}`,
          app_id: `shot-${activeVendor}`,
          display_name: vendor.displayName,
          status: 'connected',
          authorized: true,
          connected_by: 'You',
          updated_at: new Date().toISOString(),
          settings: {},
          secrets_configured: { apiKey: true },
        },
      ]),
    });
  });

  await page.route('**/organizations/*/apps/catalog-connections**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // ── Apps directory (event scope — where most people start) ──
  await page.goto(`${DST}/event/${EVENT}/apps`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByPlaceholder('Search apps').waitFor({ timeout: 20000 });
  await page.getByPlaceholder('Search apps').fill('LiveBuzz');
  await page.waitForTimeout(500);
  // Clear and show the three new cards together
  await page.getByPlaceholder('Search apps').fill('');
  const programPill = page.getByRole('button', { name: 'Program & Scheduling' });
  if (await programPill.count()) await programPill.click();
  await page.waitForTimeout(400);
  await shot(page, 'apps-directory-program');

  // Engagement for Brella
  const engagementPill = page.getByRole('button', { name: 'Engagement' });
  if (await engagementPill.count()) await engagementPill.click();
  await page.waitForTimeout(400);
  await shot(page, 'apps-directory-engagement');

  // ── Event Settings → Integrations tiles ──
  await page.goto(`${DST}/event/${EVENT}/settings/integrations`, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });
  await page.waitForTimeout(800);
  const tiles = page.locator('main').first();
  await shot(page, 'event-settings-integrations', tiles);

  // ── Per-vendor setup CTA + connect form + saved connection ──
  for (const vendor of VENDORS) {
    activeVendor = vendor.id;
    connectionsMode = 'empty';

    await page.goto(`${DST}/event/${EVENT}/apps/${vendor.id}`, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });
    await page.getByRole('button', { name: `Set up ${vendor.name}` }).waitFor({ timeout: 20000 });
    await shot(page, `${vendor.id}-setup`);

    await page.getByRole('button', { name: `Set up ${vendor.name}` }).click();
    await page.getByRole('button', { name: 'Save connection' }).waitFor({ timeout: 15000 });
    await shot(page, `${vendor.id}-connect-form`);

    connectionsMode = 'saved';
    await page.reload({ waitUntil: 'networkidle' });
    // Auto-install effect will fire because we mocked install; then connections load as saved.
    await page.getByText('Saved connections').waitFor({ timeout: 15000 }).catch(() => {});
    // If still on CTA, click Set up again
    const setup = page.getByRole('button', { name: `Set up ${vendor.name}` });
    if (await setup.count()) {
      await setup.click();
      await page.getByText('Saved connections').waitFor({ timeout: 15000 });
    }
    await shot(page, `${vendor.id}-connection`);
  }

  await browser.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
