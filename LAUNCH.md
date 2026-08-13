# Launch — live on learn.sessionboard.com

**The Help Center is live at https://learn.sessionboard.com** (cutover completed
2026-08-07). `help.sessionboard.com` 301s to it.

The site launched on `help` earlier the same day because HubSpot still held
`learn` as a Cloudflare-for-SaaS hostname — see [the `learn` blocker](#the-learn-blocker-cloudflare-1034),
kept because the failure mode is not obvious and someone will hit it again. HubSpot
released the domain at 19:39 UTC, and the cutover was one value in `site.json`.

## Launch readiness

| Gate | State |
|---|---|
| Content parity with live HubSpot KB | ✅ 220/220 published articles live; 0 missing |
| Legacy URL → new article 301s | ✅ **311/311** verified against `learn` (sitemap ∪ GSC ∪ Semrush ∪ in-app); 0 failures |
| Canonical host = `learn` | ✅ `help` 301s to `learn` in one hop |
| In-app help links | ✅ resolve; most point at `help` and take one 301 — see [in-app links](#in-app-links) |
| Build / link validation | ✅ 239 pages, 0 broken internal links |
| Live on a host we control | ✅ both hostnames are Worker Custom Domains |
| Sitemap submitted for canonical host | ✅ `learn…/sitemap.xml` accepted by GSC |
| Crawler policy (search/AEO in, scrapers out) | ✅ enforced in the Worker; ⬜ Cloudflare bot + rate-limit rules |
| Pushed to GitHub so Docs CI gates edits | ⬜ current work is deployed but uncommitted |
| HubSpot KB authoring freeze announced | ⬜ needs support team |
| Breeze agent repointed at the new domain | ⬜ can be done now |

## Cutover, as executed

1. HubSpot released `learn`; a 5-minute poller caught it. First response from our
   Worker on that host resolved a legacy KB slug correctly, so no DNS change was
   needed — the hostname was already bound as a Custom Domain.
2. `site.json` flipped: `canonicalHost` → `learn.sessionboard.com`,
   `legacyHosts` → `["help.sessionboard.com"]`. Every consumer reads that file, so
   the canonical tags, `og:url`, JSON-LD, GA4 linker, `robots.txt` sitemap line,
   share-image footer label, and the Worker's redirect direction all followed.
3. `npm run og -- --force` (239 images — the host is baked into the footer),
   `npm run build`, `npx wrangler deploy`.
4. Verified: `learn` serves 200 with canonicals on itself, `help` 301s to `learn`,
   legacy KB slugs resolve in a single hop to the final `learn` path.
5. `npm run audit:redirects` → **311/311, 0 failures**.
6. Sitemap re-submitted for the canonical host.

Propagation took roughly two minutes, during which some paths answered with the
old direction. Expect that window on any future host flip and don't panic-verify
in the first minute.

## In-app links

83 references across `web-ui-v2`, `web-ui`, and `web-api` point at the Help Center.
They were repointed from `learn` to `help` earlier on 2026-08-07, when `learn` was
403ing and every "Learn more" link in the product was a dead end. After the flip
they all still resolve — they just take one 301 to `learn`.

Repointing them again is cosmetic and touches active feature branches, so it is
deliberately **not** done. Worth folding into the next pass through those files.

The transactional email templates are the exception, because their migration had
not shipped yet. `20260807190000-help-center-host-in-email-templates` now rewrites
the two legacy KB URLs straight to their final `learn` paths
(`6283113-new-user-login` → `/event-team/new-user-login`,
`8117424-reset-password-user-instructions` → `/event-team/reset-password-user-instructions`)
with no host swap. It covers `Notification_Templates` and
`System_Notification_Templates`, does a SQL `REPLACE` rather than re-pasting HTML
so it cannot revert unrelated template edits, and is idempotent.

Two lessons from the earlier breakage, worth keeping: a redirect audit proves the
*destination* is reachable, not that anything links to it; and a `src/`-scoped grep
misses this repo layout entirely, because `sessionboard-web-api` keeps code in
`services/` and `db/`. Search the repo root.

## The `learn` blocker (Cloudflare 1034)

**Resolved 2026-08-07**, but recorded because the first two fixes look correct and
aren't, and because retrying it costs downtime.

While HubSpot held `learn.sessionboard.com` as a **Cloudflare for SaaS custom
hostname** in their account, Cloudflare refused to let our zone serve it at all.
Three attempts, in order:

1. **Proxy our DNS record and add a Worker route.** Route registered, but HubSpot
   kept answering — responses still carried `x-hs-portal-id`. Our proxied CNAME
   pointed *into HubSpot's Cloudflare zone*, so their config won (orange-to-orange).
2. **Repoint away from HubSpot** (`A → 192.0.2.1`, proxied). Every request returned
   **1034, Edge IP Restricted** — including `robots.txt`, which only our Worker can
   serve, proving the Worker still wasn't running.
3. **Repoint to a real resolvable origin**, in case the reserved IP was the issue.
   Still 1034.

DNS was correct throughout. The claim was the only cause. **Cost: ~6 minutes of
403s on `learn`.** You cannot verify a fix without briefly breaking the domain, so
do it in a maintenance window.

The release itself was a HubSpot **settings** change, not a support ticket:
portal 657654 → [domain manager](https://app.hubspot.com/domains/657654/manage)
→ remove the domain, after unassigning the Knowledge Base from it. HubSpot's
Domains API is read-only and no MCP tool exposes it, so it can't be automated —
polling for the release is the automatable half.

## Current state

| Thing | State |
|---|---|
| Canonical host | `site.json` → `canonicalHost` = `learn.sessionboard.com`. Single source of truth for `astro.config.mjs`, `Head.astro` (canonical/og:url/JSON-LD/GA4 linker), `worker.js` (`PROD_HOST`, legacy-host 301s), `generate-og.py` (share-image label), and `audit_redirects.py` (default base) |
| `learn.sessionboard.com` | **Live.** Worker Custom Domain → `sessionboard-docs` |
| `help.sessionboard.com` | Bound to the same Worker; 301s every path to `learn` |
| `sessionboard.com` zone | On Cloudflare, same account as this Worker (`7ada9117…`) |
| Redirect map | 265 live slugs in `redirects-map.json`; matches exact slug, numeric-prefix-stripped slug, then numeric article ID; unknown slugs → FAQ contact page; `/en/knowledge-base` root → `/` |
| robots.txt | Served by the Worker: allowlist/denylist policy + Sitemap on the canonical host; `Disallow: /` + `X-Robots-Tag: noindex` on the workers.dev preview host |
| Analytics | GA4 `G-Y3H82ZJMKG` + GTM `GTM-T69ZL692` (same container as www), cross-domain linker includes both hosts |

Switching hosts again is `site.json` plus
`npm run og -- --force && npm run build && npx wrangler deploy`. Both hostnames are
already bound, so nothing in `wrangler.toml` needs to change.

## What remains

1. **Commit and push the repo** so Docs CI gates edits — production is currently
   ahead of `main`.
2. **Freeze HubSpot KB authoring** — announce to the support team; new and edited
   articles land in this repo instead (PR + CI).
3. **Point Breeze at the new domain** (see below).
4. **Cloudflare bot + rate-limit rules** — see "Still to do" under Crawler policy.
5. **HubSpot cleanup** — archive the KB articles, and update Service Hub assets
   linking to old KB URLs (chat snippets, bot flows, email templates, help-widget
   links). Old links still 301; native links avoid the hop.
6. **`docusign-integration`** 404s in HubSpot today; the Worker improves it to the
   support page. The real fix is writing that article — see `PRODUCT-DELTA-AUDIT.md`.

### Smoke test (re-run after any deploy)

```bash
npm run audit:redirects                                        # 311 legacy URLs, non-zero on failure
curl -sI https://learn.sessionboard.com/ | grep -i x-robots    # must be empty
curl -s  https://learn.sessionboard.com/robots.txt | tail -2   # Sitemap on learn.
curl -s -o /dev/null -w '%{http_code}\n' -A GPTBot https://learn.sessionboard.com/   # 403
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://help.sessionboard.com/   # 301 → learn
```

Then spot-check GA4 realtime for `page_view` events from `learn.sessionboard.com`.

### Support chat (Breeze AI)

This is how the Help Center replaces HubSpot KB as the answer source for chat.
**Breeze Customer Agent can crawl a public domain**, so no article-by-article sync
and no shadow copy in HubSpot. `HubSpot` is on the Worker's allowlist.

Setup (Service → **Customer Agent** → **Train → Knowledge** → **Add content**):

1. **Import from public URLs** → `https://learn.sessionboard.com`
   - **Import related URLs** ON (crawls up to 5,000 URLs; we have 239).
   - **Which pages to import** → **This subdomain only**, so it excludes `www` and
     the marketing site, which the Marketing Site Chatflow already covers.
   - Leave **citations ON** so answers link to the real article.
2. **Remove the HubSpot Knowledge Base source** in the same screen once the KB is
   archived. If both remain, the agent answers from — and cites — a retired source.
3. Assign the agent on the chatflow that should use it. The Help Desk inbox has two
   inactive **AI Agent Tester** Live Chat flows to validate on before pointing
   **Support Chatflow** at it.
4. Re-crawl is **weekly, automatic**. After a large docs push, hit **Refresh** on
   the imported URL source instead of waiting.

Point it at `learn.`, not at the workers.dev preview host, which serves
`Disallow: /` and `X-Robots-Tag: noindex`.

### T-plus 1–2 weeks

- `gsc_health_check.py` — watch index coverage, soft-404s, and whether Google
  reshuffles from the old KB URLs to the new paths on the same host.
- Watch Worker analytics for the fallback redirect (unknown slugs) — a spike means
  a slug pattern we missed; add it to `redirects-301.csv` and redeploy.
- GA4: compare Help Center sessions against the baseline below.

## 301 audit — the full URL surface (2026-08-07)

The article export is not the URL surface. Enumerating from four independent
sources found **291** legacy URLs, ~70 more than the 220 articles we had mapped:

| Source | URLs | Why it finds things the others miss |
|---|---|---|
| Live HubSpot sitemap | 222 | Ground truth for what HubSpot served |
| Google Search Console (16 mo) | 270 | Indexed URLs HubSpot **omits** from its sitemap — category pages, deleted articles |
| Semrush `backlinks_pages` | ~250 | URLs with **external backlinks**, i.e. the authority we'd forfeit |
| `rg` over web-api / web-ui-v2 / web-ui | 23 | In-product help links, which no crawler can see |

**Result: 311 of 311 resolve 301 → 200 — zero failures.** (311 rather than 291
because the sweep also drives every historical slug in `redirects-301.csv`.) Eleven
fall through to the contact-support page: eight are HubSpot
`-temporary-slug-<uuid>` placeholders and three are ambiguous draft slugs — all
verified 404 in HubSpot, so a support page is a strict improvement.

HubSpot-hosted `/hs-fs/hubfs/` **images** (3 URLs, ≈5 impressions in 16 months) are
excluded by design — redirecting an image request to an HTML page is worse than
letting it fail. Sitemap XML and other machine files are excluded for the same
reason: they serve 200 but have no article target.

### What only this audit caught

- **9 KB category pages** — `frequently-asked-questions`, `training-videos`,
  `product-release-notes`, `portal-users`, `integrations`,
  `feature-overview-guides`, `sessionboard-how-tos`,
  `understanding-sessionboard-terms-roles`, `kb-search-results`. Live and ranking,
  but not articles, so they were **absent from the export entirely**. Four section
  hubs (`/faq/overview`, `/videos/overview`, `/release-notes/overview`,
  `/participants/overview`) were written to give them honest targets — which also
  made sidebar groups clickable and gave us category pages to rank.
- **`/en/migrated/knowledge-base/…`** — a path prefix from an *earlier* HubSpot
  migration that Google still has indexed.
- **HubSpot's own slug renames** — `6284057-create-assign-tasks` →
  `6284057-assign-tasks`. The Worker indexes on the **numeric article ID**, so a
  rename resolves without anyone noticing.
- **HubSpot serving broken 301s** — two articles redirected to a doubled
  `/en/knowledge-base/en/knowledge-base/<slug>` path that 404s. Normalized.
- **17 URLs** that previously fell through to the contact FAQ now land on their
  nearest published article.

### Traffic baseline — read this before judging the migration

One article, `8103124-why-does-my-computer-say-this-site-can-t-be-reached`, was
**59% of all KB clicks** (4,905 of 8,256) and 63% of impressions over 16 months. It
ranked for the generic Chrome error string, at a 0.6% CTR. The team unpublished and
`noindex`ed it around **April 2026**, and it has produced **0 clicks in the last 30
days**.

The pre-cutover baseline is therefore **~262 clicks / 30 days** (782 / 90 days),
*not* the 16-month total. Comparing against the 16-month figure would show a fake
~60% collapse that happened months ago for unrelated reasons.

Because the Help Center now lives on the hostname that holds all the history and
backlinks, there is no ranking handover to wait out — the reason the cutover was
worth doing on the day the domain came free.

### Re-run it

`scripts/audit_redirects.py`, registered in the agent toolbelt
([`AGENT_TOOLBELT.md`](../sessionboard-tam/growth-org/AGENT_TOOLBELT.md) §9) so it
gets re-run as part of doing the work rather than as a step someone remembers. Exits
non-zero if any legacy URL fails to reach a live page. No credentials or venv setup.

```bash
cd sessionboard-docs
npm run build && node scripts/redirects-to-map.mjs   # targets validated against dist/
npm run audit:redirects                              # defaults to the canonical host
```

## Crawler policy — rank in search, don't feed competitors

The goal is asymmetric: stay visible to engines that send readers back, while
denying the bulk-copy paths a competitor would actually use.

**There is no version of this where the docs rank but cannot be read.** Ranking in
Google and being cited by ChatGPT/Perplexity both require those crawlers to fetch
the full page text, and anything they can fetch, a person can fetch. The lever is
not *whether* content is readable — it is *who* reads it, *how cheaply*, and *at
what volume*.

### What the Worker enforces (live)

| Class | Examples | Treatment |
|---|---|---|
| Search engines | Googlebot, Bingbot, Applebot, DuckDuckBot | Allowed |
| AI engines that cite + link | OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Google-Extended | Allowed |
| Our own tooling | SemrushBot, SiteAuditBot, HubSpot (Breeze) | Allowed |
| AI training corpora | GPTBot, ClaudeBot, CCBot, Bytespider, Meta-ExternalAgent | **403 at edge** |
| Competitor recon | AhrefsBot, DataForSeoBot, MJ12bot, Diffbot, ZoominfoBot, Scrapy | **403 at edge** |
| Bulk exports | `/llms.txt`, `/llms-full.txt`, `/llms-small.txt` | **404 for everyone** |

Two deliberate choices:

- **`GPTBot` blocked, `OAI-SearchBot` allowed.** OpenAI uses separate agents for
  model training and for the index behind ChatGPT search citations. Same split for
  `ClaudeBot` vs. `Claude-SearchBot`. We keep every citation path and give up only
  the training copy. `Google-Extended` stays allowed because it powers Gemini
  grounding, which cites, and has no bearing on Search rank.
- **The `llms-*.txt` dumps are the real exposure**, not the HTML. They are the whole
  Help Center in one GET — the most valuable thing on the domain to a competitor and
  cheaper than crawling 239 pages. Google has said it does not use `llms.txt`, so
  withholding them costs no ranking. We still generate them: `dist/llms-small.txt`
  is what we upload to Breeze and the corpus for our own chat later. They just
  aren't fetchable from the internet.

The denylist is enforced by User-Agent at the edge, not only in `robots.txt`, which
is advisory. Both lists live in `ALLOWED_BOTS` / `BLOCKED_BOTS` in `worker.js`;
adding a crawler is one string.

`robots.txt` leaves the default `User-agent: *` group on `Allow: /` (pages only,
never the dumps). A blanket `Disallow: /` is the intuitive move but buys nothing — a
competitor scraping us ignores `robots.txt` — while risking the silent loss of a
search surface that matters later, since new AI engines appear faster than we would
notice adding them to an allowlist. The teeth are at the edge.

### The machine index — `/_internal/help-index.json`

`npm run build` also emits `dist/_internal/help-index.json`: every article, chunked
by heading, with a `contentHash` per article and the sanitized body HTML. This is
what `sessionboard-web-api` pulls in nightly (`HELP_DOCS_SYNC`) to embed for Team
Lead and for the in-product reader. It is the same exposure as the `llms-*.txt`
dumps — the whole corpus in one GET — so the Worker gates every `/_internal/`
request on a bearer token and answers a wrong or missing one with the same 404 an
unknown path gets.

**Deploying it needs one secret on each side, and they must match:**

```bash
# Help Center Worker (this repo). NOT a [vars] entry — that would commit it.
cd sessionboard-docs && npx wrangler secret put HELP_INDEX_TOKEN

# sessionboard-web-api, per environment
HELP_INDEX_URL=https://learn.sessionboard.com/_internal/help-index.json
HELP_INDEX_TOKEN=<the same value>
```

Verify after a deploy — the first is the failure mode to recognize, because a
missing secret looks exactly like a missing file:

```bash
curl -sI https://learn.sessionboard.com/_internal/help-index.json            # 404
curl -sI -H "Authorization: Bearer $HELP_INDEX_TOKEN" \
  https://learn.sessionboard.com/_internal/help-index.json                    # 200
```

Leaving `HELP_INDEX_URL`/`HELP_INDEX_TOKEN` unset in web-api is a supported state:
the sync job logs and no-ops rather than failing, so a review app without a Help
Center does not page anyone. A token that is set but *wrong* fails the job loudly,
which is the intended asymmetry.

### Still to do (needs Cloudflare dashboard access)

The Worker stops crawlers that identify themselves honestly. A determined competitor
sends a browser User-Agent instead, and only volume-based controls catch that. On
the `sessionboard.com` zone, for `learn.sessionboard.com/*`:

1. **Security → Bots → Block AI Scrapers and Crawlers: ON.** Cloudflare's maintained
   list, updated far more often than ours, verified by signature rather than by
   trusting the User-Agent string.
2. **Rate limiting:** >120 requests/minute per IP → managed challenge. Normal readers
   hit a handful of pages; a full-site scrape is hundreds in a minute. Exempt
   verified bots (`cf.client.bot`) so Googlebot is never throttled.
3. **Bot Fight Mode: ON** — challenges headless clients spoofing a browser UA.

Skipping these leaves the policy about as strong as `robots.txt` alone against
anyone acting in bad faith.

## Rollback

Both hostnames are Worker Custom Domains with no origin (`AAAA → 100::`), so there
is no previous state to restore — HubSpot no longer serves `learn`. Roll forward.

To move the canonical host back to `help`, swap the two values in `site.json` and
redeploy; the Worker reverses the redirect automatically. To take the site down
entirely you would remove the `[[routes]]` blocks, which fails closed rather than
serving something stale. That is the intended trade.

## Known gaps / accepted risks

- **HubSpot KB search URLs** (`/en/knowledge-base?q=…`) → redirect to `/`;
  acceptable, Pagefind search is on every page.
- **Article slugs renamed inside HubSpot after the last sync** are largely absorbed
  by matching on the numeric article ID, which HubSpot keeps across renames. A slug
  renamed *and* re-IDed would miss and hit the FAQ fallback — the authoring freeze
  closes that.
- **In-app links take one 301** while they point at `help`. Harmless; see
  [in-app links](#in-app-links).
- **No origin behind either hostname.** If the Worker is deleted or a Custom Domain
  unbound, the hostname fails closed rather than serving something stale.
