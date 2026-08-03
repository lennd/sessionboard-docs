# Sessionboard docs — project instructions

## About this project

- Self-hosted documentation site for **Sessionboard**, built on [Astro Starlight](https://starlight.astro.build) and deployed to Cloudflare Workers.
- Pages are MDX files with YAML frontmatter in `src/content/docs/`; the sidebar lives in `src/sidebar.json` (regenerate legacy nav with `npm run sidebar`); site config in `astro.config.mjs`.
- Migrated from the HubSpot Knowledge Base at `learn.sessionboard.com` (see `MIGRATION.md` for the old→new map and `redirects-301.csv` for 301s). Until cutover, `scripts/hubspot-article-to-md.py` converts live HubSpot articles for parity syncs.
- **Read `STYLE.md` before writing or editing any page.** It defines voice, terminology, formatting, and the component decision table.

## Commands

```bash
npm run build     # full build: MDX compile, Pagefind index, link validation
npm run dev       # local preview at localhost:4321
npm run sidebar   # regenerate src/sidebar.json from legacy docs.json
python3 scripts/rehost-images.py   # download + localize any external images
```

The build fails on broken internal links (starlight-links-validator). Always run `npm run build` after content changes.

## Information architecture

Docs are organized to mirror the **admin nav** (org/event level):

- **Guides** — Get started · Core concepts · Program (Sessions, Speakers, Evaluations, Sponsors & exhibitors, Portals, Contacts) · CRM · Marketing · Awards · CMS · Reports · Agents · Event Team · Settings
- **Participant guide** — end-user docs for speakers/sponsors/exhibitors using portals
- **Apps** — App Marketplace connectors + Developer (API, webhooks, MCP)
- **Help** — FAQ & troubleshooting · Video tutorials · Release notes

When adding a page: put the MDX file in the matching folder under `src/content/docs/`, add its slug to the matching group in `src/sidebar.json`, and add a row to `redirects-301.csv` if it replaces a HubSpot article.

## Hard rules

- URL paths are load-bearing: they back 301s, chat citations, and the Team Lead retrieval index. Never rename a slug without adding a redirect.
- Images live in `public/images/` — no external image hosts.
- Component imports come from `@compat` or `@astrojs/starlight/components` (see `STYLE.md`).
- Add-on features (Speaker CRM, Awards, SSO, Insights, Program Site) use `<AddOnNote>`.
- Don't document internal-only admin/superuser tooling.
- Automated content changes (parity syncs, code-change audits, question-gap drafts) always land as PRs, never direct pushes.

## Related pipelines

- `walkthroughs/` — auto-generated narrated video clips (spec → Playwright capture → TTS → render → `<Walkthrough>` embed). See `walkthroughs/README.md`.
- `scripts/` — parity/import tooling.
