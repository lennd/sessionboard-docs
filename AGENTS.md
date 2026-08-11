# Sessionboard docs — project instructions

## About this project

- Self-hosted documentation site for **Sessionboard**, built on [Astro Starlight](https://starlight.astro.build) and deployed to Cloudflare Workers.
- Pages are MDX files with YAML frontmatter in `src/content/docs/`; the sidebar lives in `src/sidebar.json` (regenerate legacy nav with `npm run sidebar`); site config in `astro.config.mjs`.
- The published host lives in `site.json` (`canonicalHost` / `legacyHosts`) — never hardcode a hostname; `astro.config.mjs`, `Head.astro`, `worker.js`, and `generate-og.py` all read it, and the Worker 301s any legacy host to the canonical one. Changing hosts means editing that one file, then `npm run og -- --force && npm run build && npx wrangler deploy`.
- Live at `learn.sessionboard.com`, migrated off the HubSpot Knowledge Base that used to serve that hostname; `help.sessionboard.com` 301s to it. The canonical host is `site.json` — never hardcode a hostname, since every consumer reads that file. See `MIGRATION.md` for the old→new map and `redirects-301.csv` for 301s; `scripts/hubspot-article-to-md.py` converts live HubSpot articles for parity syncs.
- **Read `STYLE.md` before writing or editing any page.** It defines voice, terminology, formatting, and the component decision table.

## Commands

```bash
npm run build            # full build: MDX compile, Pagefind index, link validation
npm run dev              # local preview at localhost:4321
npm run check:style      # STYLE.md rules Vale can't see: titles, structure, alt text
npm run sidebar          # regenerate src/sidebar.json from legacy docs.json
npm run audit:redirects  # verify every legacy HubSpot URL still 301s to a live page
npm run cf:check         # Cloudflare anti-scraping rules: show drift (--apply to deploy)
python3 scripts/rehost-images.py   # download + localize any external images
```

Several scripts need Python 3.10+; the system `python3` on macOS is 3.9, so run them
with `python3.13`.

## Recovering content from the old HubSpot knowledge base

The KB still exists inside HubSpot even though no domain serves it. It is reachable
only through the CMS GraphQL collector (`KB { knowledge_article_collection }`), using
`HUBSPOT_PRIVATE_APP_TOKEN` from `~/.zshrc`. There is no public REST API for knowledge
articles, `/knowledge-content/v1/` refuses private-app tokens, and the Wayback Machine
archived barely any of these pages — the collector is the only complete source.

`.kb-archive/` is a committed snapshot of all 221 articles: original body HTML with
screenshots, callouts and embeds intact. Refresh it with:

```bash
python3.13 scripts/hubspot_kb_export.py     # -> .kb-archive/{index.json,html/*.html}
```

35 pages were hand-rewritten during the migration rather than imported, which cost them
their screenshots and most of their body copy (`disposition` in `redirects-301.csv` says
which). To rebuild one from the archive:

```bash
python3.13 scripts/kb_restore.py --list              # what is missing, and by how much
python3.13 scripts/kb_restore.py --path /x/y --write # keeps existing frontmatter
python3.13 scripts/rehost-images.py                  # pull screenshots local
python3.13 scripts/normalize_images.py --apply       # unwrap images from headings/tables
python3.13 scripts/fix-alt-text.py --apply           # alt text from surrounding prose
python3.13 scripts/fix_legacy_links.py --apply       # /en/knowledge-base/* + dead anchors
npm run check:style && npm run build
```

Restoring overwrites the page, so check `git log` first: where a page has been edited
since the migration for product accuracy, merge by hand instead — the archive predates
those corrections and will silently undo them.

The build fails on broken internal links (starlight-links-validator). Always run `npm run build` after content changes.

`npm run check:style` enforces the mechanical half of `STYLE.md` — title form and length, first heading level, stranded tables of contents, image alt text, truncated descriptions. It runs in CI beside Vale, which only sees prose. Everything it flags is a HubSpot migration artifact, so fix the page rather than loosening the rule.

**Purge the cache after deploying content changes.** `wrangler deploy` updates the Worker, but Cloudflare keeps serving the previous HTML from its edge cache (`CF-Cache-Status: HIT`) — a renamed title can stay stale on a handful of pages while the rest update, which looks like a partial deploy and is not. The deploy token can purge:

```bash
ZONE=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=sessionboard.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Verify against the live host afterwards, not `dist/` — the build being right is what makes a stale page confusing.

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
