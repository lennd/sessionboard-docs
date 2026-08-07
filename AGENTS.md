# Sessionboard docs — project instructions

## About this project

- Self-hosted documentation site for **Sessionboard**, built on [Astro Starlight](https://starlight.astro.build) and deployed to Cloudflare Workers.
- Pages are MDX files with YAML frontmatter in `src/content/docs/`; the sidebar lives in `src/sidebar.json` (regenerate legacy nav with `npm run sidebar`); site config in `astro.config.mjs`.
- Live at `help.sessionboard.com`. Migrated from the HubSpot Knowledge Base at `learn.sessionboard.com`, which HubSpot still serves — it cannot be pointed at this Worker until a HubSpot admin releases the hostname (`LAUNCH.md` explains why, and what breaks if you try). See `MIGRATION.md` for the old→new map and `redirects-301.csv` for 301s; `scripts/hubspot-article-to-md.py` converts live HubSpot articles for parity syncs.
- **Read `STYLE.md` before writing or editing any page.** It defines voice, terminology, formatting, and the component decision table.

## Commands

```bash
npm run build            # full build: MDX compile, Pagefind index, link validation
npm run dev              # local preview at localhost:4321
npm run sidebar          # regenerate src/sidebar.json from legacy docs.json
npm run audit:redirects  # verify every legacy HubSpot URL still 301s to a live page
python3 scripts/rehost-images.py   # download + localize any external images
```

The build fails on broken internal links (starlight-links-validator). Always run `npm run build` after content changes.

`npm run audit:redirects` is the gate on the 301 surface. It enumerates legacy URLs from the live HubSpot sitemap, Search Console, `redirects-301.csv`, and in-app links in the product repos, then drives every one through the deployed Worker. It exits non-zero if any URL would 404 or loop, so run it after renaming a slug, adding or removing an article, or touching `worker.js`. Regenerate the map first (`node scripts/redirects-to-map.mjs`) so it reflects the current build. No credentials or venv to set up — it finds them. Details in `AGENT_TOOLBELT.md` §9.

## Information architecture

Docs are organized to mirror the **admin nav** (org/event level):

- **Guides** — Get started · Core concepts · Program (Sessions, Speakers, Evaluations, Sponsors & exhibitors, Portals, Contacts) · CRM · Marketing · Awards · CMS · Reports · Agents · Event Team · Settings
- **Participant guide** — end-user docs for speakers/sponsors/exhibitors using portals
- **Apps** — App Marketplace connectors + Developer (API, webhooks, MCP)
- **Help** — FAQ & troubleshooting · Video tutorials · Release notes

When adding a page: put the MDX file in the matching folder under `src/content/docs/`, add its slug to the matching group in `src/sidebar.json`, and add a row to `redirects-301.csv` if it replaces a HubSpot article.

## Hard rules

- URL paths are load-bearing: they back 301s, chat citations, and the Team Lead retrieval index. Never rename a slug without adding a redirect, and run `npm run audit:redirects` afterwards rather than checking a few URLs by hand.
- Images live in `public/images/` — no external image hosts.
- Component imports come from `@compat` or `@astrojs/starlight/components` (see `STYLE.md`).
- Add-on features (Speaker CRM, Awards, SSO, Insights, Program Site) use `<AddOnNote>`.
- Don't document internal-only admin/superuser tooling.
- Automated content changes (parity syncs, code-change audits, question-gap drafts) always land as PRs, never direct pushes.

## Related pipelines

- `walkthroughs/` — auto-generated narrated video clips (spec → Playwright capture → TTS → render → `<Walkthrough>` embed). See `walkthroughs/README.md`.
- `scripts/` — parity/import tooling.
