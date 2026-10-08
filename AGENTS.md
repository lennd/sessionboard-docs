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
python3.13 scripts/fix_lists.py --write              # nesting, step screenshots, ZWSP junk
python3.13 scripts/restore_bold_labels.py --write    # **Label:** lead-ins, from the archive
npm run check:style && npm run build
```

`fix_lists.py` and `restore_bold_labels.py` repair what conversion did to lists, which is
the single largest source of "the data is there but it's hard to read" feedback. HubSpot
wrote parents as `-  Item` — two spaces — so children indented by 2 fell short of the
parent's content column and rendered as siblings; the ASP page listed sync caveats as if
they were synced fields. Both scripts move whitespace and emphasis only, never prose, and
both are idempotent, so re-run them after any restore. `check:style` fails on what they
fix (`flat-list`, `orphan-list-item`), so a regression cannot ship.

Both skip frontmatter, and `fix_lists.py` never pulls a list out to column 0 — a list
inside a `<Step>` is indented on purpose and de-indenting it closes the component early.

Restoring overwrites the page, so check `git log` first: where a page has been edited
since the migration for product accuracy, merge by hand instead — the archive predates
those corrections and will silently undo them.

The build fails on broken internal links (starlight-links-validator). Always run `npm run build` after content changes.

**Always deploy after any docs change.** Do not leave Help Center edits local-only and do not wait to be asked. From this directory: `npm run check:style && npm run breadcrumbs && npm run og && npm run build && npx wrangler deploy`, then purge the edge cache (below). Verify the live host in `site.json`.

**Commit and push before you stop — and regenerate breadcrumbs first.** Docs CI on `main` regenerates `src/breadcrumbs.json` and fails the push if the committed file is stale, so any page add/rename/move/sidebar change must ship with a freshly regenerated `src/breadcrumbs.json` (and its `public/og/` image) **in the same push**. This checkout is shared by concurrent agent sessions: `git pull --rebase` before committing (stash/pop around it if the tree is dirty), re-run `npm run breadcrumbs` *after* the pull so it reflects everyone's pages, and commit only your own files — described honestly if you must sweep a stray hunk. Four consecutive pushes failed CI on 2026-09-12 because none of them did this. Also remember `npx wrangler deploy` ships the **entire working tree**, including other sessions' uncommitted edits — that is accepted here (docs edits must always deploy anyway), but do not let it surprise you.

`npm run check:style` enforces the mechanical half of `STYLE.md` — title form and length, first heading level, stranded tables of contents, image alt text, truncated descriptions. It runs in CI beside Vale, which only sees prose. Everything it flags is a HubSpot migration artifact, so fix the page rather than loosening the rule.

**Purge the cache after deploying content changes.** `wrangler deploy` updates the Worker, but Cloudflare keeps serving the previous HTML from its edge cache (`CF-Cache-Status: HIT`) — a renamed title can stay stale on a handful of pages while the rest update, which looks like a partial deploy and is not. Docs CI purges automatically after its deploy on `main` (before the smoke test); after a hand deploy, the deploy token can purge:

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

## Release notes (mandatory with every product-docs round)

Release notes are **data, not prose**: one file per date in `src/data/release-notes/YYYY-MM-DD.json`. **Any docs round that documents a shipped product change must also add an entry there, in the same commit.** `src/content/docs/help/release-notes.mdx` only renders the data — never add bullets to it. The same entry feeds the public page, the staff-only enablement section (`/enablement`, see below), the daily Slack digest to #product-development, `dist/_internal/release-notes.json` (TAM Hub, Community drafts) and CI. There is no second list to keep in sync.

Why: CS kept finding features in the release notes that were not in production yet, and could not tell from a bullet who a change was for or how to turn it on. Every entry now answers those questions, and nothing is announced until it is live.

Rules (`npm run release:check` enforces them; `scripts/check-release-notes.mjs`):

- `id` is a kebab-case slug, unique across all dates — it is the URL of the enablement page.
- `title`, `summary` (one or two sentences of what the user can now do; bold/code/links only), `article` (the guide; must exist), `kind` (`new` | `improved` | `fixed`), `module` (one of the Help Center groups; derived from the article folder when omitted).
- **Who / where / how to turn it on:** `features` (contract slugs — `availability`, `enable.how` and `where.scope` are derived from the product contract when set), `enable.path` (the menu path the customer follows; required unless on by default), `where.path` (where the change shows up), `permissions`, `audience`.
- **Why:** `use_case` — one or two sentences a CSM could say to a customer about why they would want this.
- **For CS (never public):** `internal.cs_action` (`none` | `must_enable` | `can_disable` | `review_before_customers_see` | `reach_out`, with a `note`), `internal.when_to_bring_up`, `internal.who_should_get_it`, `internal.staff_path`, `internal.gotchas`, `internal.talk_track`.
- **Production status:** `shipped.prs` — every PR in `lennd/<repo>#<n>` form, or `shipped.docs_only: true`. If you are documenting from a branch whose PR does not exist yet, set `shipped.pending: "<branch or ticket>"` and come back to fill in `prs` — the entry stays "Not in production yet" until you do, and the daily job nags about it. Leave `shipped.live` as nulls: `scripts/release-status.mjs` (the daily workflow) flips each region when the PR is in the last successful production deploy, and only then does the entry appear publicly or in Slack. **Never hand-write a live date.**
- Entries describe **product changes users can see**. Docs-only work (rewrites, screenshots, style fixes) and internal tooling do **not** get entries.
- Never invent a date — the file name is the day the change was documented, not a guess at when it will deploy.

Copy the newest file as a template; `src/data/release-notes/_config.json` lists the repos and their production workflows.

### The one automated commit on main

`.github/workflows/release-daily.yml` runs every weekday morning: it refreshes `shipped.live` from the production deploy workflows, posts the Slack digest for entries that became live, writes `shipped.announced_at`, and commits the data files back to `main` as `github-actions[bot]`. That is the single exception to "every change lands through a PR" in this repo, and it touches only `src/data/release-notes/`. If it fails, fix the data; do not post to Slack by hand. The TAM Hub's **Product Updates** page (`#/product-updates`) shows the working digest (live, not yet announced) all day and dispatches this same workflow on demand — `mode: status` to refresh live dates, `mode: publish` to post now — so a publish from the hub and the morning run never double-post: both key off `shipped.announced_at`.

### Community "What's new" drafts

`npm run release:community` prints a customer-facing Community draft for every live entry (summary, why you'd use it, who gets it, how to turn it on, guide link — never `internal.*`). `--push` with `SB_API_BASE` and `SB_API_TOKEN` (a super-user session token) creates them as **drafts** through `POST /community/admin/changelog`, labelled `release:<id>` so re-runs never duplicate; a human publishes from the Community console. It is not in the daily workflow on purpose: the admin router is super-user-only and session tokens last a day, and the only other credential it takes is the cross-region community service key, which does not belong in this repo. Making it unattended is a web-api change (an internal API-key path on that router), not a secret to add here.

### Enablement section (`/enablement`) — staff only, unlisted

`src/pages/enablement/` is the CS view of every release: status per region, why it matters, when to bring it up, who should get it, staff enable path, videos, gotchas. It is **open but unlisted**: not in the sidebar, search, sitemap, llms.txt, help-index or robots.txt; `noindex` meta + `X-Robots-Tag` + `no-store` from `worker.js`. `npm run internal:check` (CI) fails on any public link to it and on anything secret-looking (webhook URLs, tokens, emails) in the release data or the section's source. Do not link to it from any article, and do not put customer names, emails or credentials in `internal.*`.

## Hard rules

- URL paths are load-bearing: they back 301s, chat citations, and the Team Lead retrieval index. Never rename a slug without adding a redirect, and run `npm run audit:redirects` afterwards rather than checking a few URLs by hand.
- Images live in `public/images/` — no external image hosts. New UI screenshots: 2x PNG clipped to the control (`CLAUDE.md` Screenshots). Do not JPEG a tabpanel.
- Component imports come from `@compat` or `@astrojs/starlight/components` (see `STYLE.md`).
- Add-on features (Speaker CRM, Awards, SSO, Insights, Program Site) use `<AddOnNote>`.
- Don't document internal-only admin/superuser tooling.
- Automated content changes (parity syncs, code-change audits, question-gap drafts) always land as PRs, never direct pushes.

## Related pipelines

- **Galleries are derived, never curated.** `src/lib/article-media.mjs` reads an article's own MDX for its training chapters, walkthrough clips and `![]()` screenshots (videos first, then the screenshots from the section an anchor points at, then the rest). That whole-article list drives `<Gallery />` inside an article (`<Gallery only="images" />` when the chapter is already embedded above it — put it after the intro, before `## Why use it`). **A release entry shows only what is pertinent to that line item** (`mediaForEntry`): the entry's own `media: ["/images/kb/….png", …]` when set; otherwise the screenshots (and any chapter embedded) in the section its `article#anchor` points at, subsections included; otherwise no thumbnail at all — never the whole guide. So to give a release a thumbnail: anchor `article` to the section that shows the change, or list `media` on the entry (paths must exist under `public/`; `npm run release:check` verifies). The thumbnail on release-notes entries and Enablement cards and the "What it looks like" grid on `/enablement/releases/<id>` all come from that. Everything opens the same lightbox (`src/components/MediaGallery.astro`: arrows/keys, filmstrip, videos play from the chapter marker).
- `walkthroughs/` — auto-generated narrated video clips (spec → Playwright capture → TTS → render → `<Walkthrough>` embed). See `walkthroughs/README.md`.
- `scripts/` — parity/import tooling.
