# sessionboard-docs (Help Center)

Starlight Help Center. Canonical host is `site.json` — never hardcode `learn.` / `help.`. **Always deploy before you stop** (`AGENTS.md`).

Read `STYLE.md` before editing a page.

## Screenshots (`public/images/kb/`)

UI chrome is 1x JPEG-compressed in the article if you capture it wrong — text goes muddy and tabpanels look like a tall empty card. Do this every time:

1. **PNG, `deviceScaleFactor: 2`.** Never JPEG for product UI. Never html2canvas (garbles text).
2. **Clip the control the sentence is about**, not `main` / `[role=tabpanel]` / the viewport. Tabpanels are often `min-height: remaining viewport`, so a locator screenshot of the panel is a short table plus a huge blank.
3. Persist with **Playwright** `page.screenshot({ type: 'png', clip, animations: 'disabled' })` into `public/images/kb/`. Chrome DevTools is fine for finding the UI; its `filePath` cannot write into this repo.
4. Pad the clip ~12–16 CSS px. Hide `[aria-label="Sessionboard staff only"]`. Auto-dismiss **Skip tour**.
5. Login from `SESSIONBOARD_LOCAL_USERNAME` / `SESSIONBOARD_LOCAL_PASSWORD` in `~/.config/secrets.zsh` — never print creds.
6. Descriptive filename + alt that describes the **image**, not the page title. Update the MDX path if you change extension (`.jpg` → `.png`).
7. Open the PNG and check: sharp type, no empty canvas below the last pixel of UI, no staff-only lock.

Admin is `:8080` (Vite proxy). Program Site / public vote is `:8081` talking to `:3001` — if the API is mid-nodemon restart you get `Failed to fetch`; wait and retry. Always `localhost`, never `127.0.0.1` (CORS).

Practicalities that cost time when rediscovered:

- Playwright is **not** installed in this repo. Import it by absolute path from the UI repo: `import { chromium } from '/…/sessionboard-web-ui-v2/node_modules/playwright/index.mjs'` (Chromium is already cached in `~/Library/Caches/ms-playwright`). ESM resolves from the script's location, not cwd, so a bare `'playwright'` import fails for a script in `/tmp`.
- Playwright's `addStyleTag` takes `{ content }`, not `{ contents }` (the chrome-devtools MCP uses `contents` — easy to cross-wire).
- Skip the login form: inject `access_token` / `id_token` / `refresh_token` into localStorage on `/login`, then navigate (keys per `web-ui-v2/src/lib/auth.ts`).
- Deep links that skip fragile menu clicking: portal editor steps are routable (`/event/:eventId/portals/:portalId/configuration`, also `/criteria`, `/customize`, `/appearance`); Program Settings tabs too (`/event/:eventId/sessions/settings/agenda`). Portal ids = `Config_Sets.id`.
- Grid columns hidden behind the Columns picker: scripted `element.click()` does not register on the Radix checkboxes — click by accessibility ref/uid, or in Playwright use `getByRole('checkbox', { name: … })`.

## Release notes

Documenting a shipped product change? Add a dated entry to `src/content/docs/help/release-notes.mdx` in the same commit — format and inclusion rules in `AGENTS.md` (Release notes section). Docs-only edits don't get entries.

## Before you stop (CI gate)

After any page add/rename/move or `src/sidebar.json` change, run `npm run breadcrumbs` **after** pulling latest `main`, and commit the regenerated `src/breadcrumbs.json` with your change — Docs CI fails the push otherwise. Full loop and shared-checkout etiquette: `AGENTS.md`.
