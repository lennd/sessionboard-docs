# Launch — live on help.sessionboard.com

**The Help Center is live at https://help.sessionboard.com** (2026-08-07).

The original plan was to take over `learn.sessionboard.com` in place, so legacy
article URLs would keep their domain and need only a path-level 301. That turned
out not to be possible while HubSpot still holds the hostname — see
[the `learn` blocker](#the-learn-blocker-cloudflare-1034) below. So the site
launched on `help.sessionboard.com`, which we control end to end, and `learn`
becomes a cross-host 301 the moment HubSpot releases it. The Worker already
implements that redirect, so finishing the job is a DNS change and nothing else.

## Launch readiness

| Gate | State |
|---|---|
| Content parity with live HubSpot KB | ✅ 220/220 published articles live; 0 missing |
| Legacy URL → new article 301s | ✅ **311/311** verified end-to-end against the live host (sitemap ∪ GSC ∪ Semrush ∪ in-app); 0 failures |
| In-app help links keep working | ✅ 23/23 resolve 301 → 200 (incl. `docusign-integration`, which 404s in HubSpot today) |
| Build / link validation | ✅ 228 pages, 0 broken internal links |
| Pushed to GitHub so Docs CI gates edits | ✅ |
| Live on a host we control | ✅ `help.sessionboard.com` (Worker Custom Domain) |
| Crawler policy (search/AEO in, scrapers out) | ✅ enforced in the Worker; ⬜ Cloudflare bot + rate-limit rules |
| **HubSpot releases `learn.sessionboard.com`** | ⬜ **needs a HubSpot admin — the one remaining blocker** |
| HubSpot KB authoring freeze announced | ⬜ needs support team |
| Breeze agent repointed at the new domain | ⬜ can be done now (see below) |

Content, redirects, and hosting are done. What is left is one HubSpot admin action
and a team announcement.

## The `learn` blocker (Cloudflare 1034)

`learn.sessionboard.com` **cannot be served from our zone while HubSpot holds it.**
This was established the hard way on 2026-08-07, and it is worth recording because
the failure mode is not obvious and the first two fixes look correct but aren't.

What was tried, in order:

1. **Proxy our DNS record and add a Worker route.** The route registered fine, but
   HubSpot kept answering — responses still carried `x-hs-portal-id` and HubSpot's
   own `robots.txt`. Our proxied CNAME pointed *into HubSpot's Cloudflare zone*, so
   their configuration won and our Worker never ran (orange-to-orange).
2. **Repoint the record away from HubSpot** (`A → 192.0.2.1`, proxied) so there was
   nothing of HubSpot's to defer to. Every request then returned **Cloudflare error
   1034, Edge IP Restricted** — including `robots.txt`, which only our Worker can
   serve. So the Worker was still not running.
3. **Repoint to a real resolvable origin** in case the reserved IP was the problem.
   Still 1034.

The cause is that HubSpot has `learn.sessionboard.com` registered as a **Cloudflare
for SaaS custom hostname** in their own account. While that registration exists,
Cloudflare refuses to let our zone serve the hostname, no matter what our DNS says.
DNS was verified correct throughout — `learn` resolved to the same anycast IPs as
`www.sessionboard.com`, which has a working Worker route in this zone.

`learn` was rolled back to HubSpot and is serving normally. **Cost: ~6 minutes of
403s on `learn` during the attempt.** If you retry this, do it in a maintenance
window, because you cannot verify it without breaking the domain briefly.

### To finish the cutover (HubSpot admin required)

Either option works; the first is cleaner.

1. **Detach the domain in HubSpot** — Settings → Content → Domains & URLs, remove
   `learn.sessionboard.com`. Wait for HubSpot to release the custom hostname, then:

   ```toml
   # wrangler.toml — uncomment
   [[routes]]
   pattern = "learn.sessionboard.com/*"
   zone_name = "sessionboard.com"
   ```

   …point the DNS record at the Worker (proxied), `npx wrangler deploy`, and run
   `npm run audit:redirects -- --base https://learn.sessionboard.com`. The Worker
   already 301s every `learn` request to the same path on `help` in a single hop,
   resolving legacy KB slugs on the way — no code change needed.

2. **Have HubSpot serve the redirect** — a domain-level 301 from
   `learn.sessionboard.com/*` to `help.sessionboard.com/*` preserving the path. Our
   Worker handles `/en/knowledge-base/<slug>` on `help` identically, so this works
   without per-article mapping. Slightly worse (two hops, and we stay dependent on
   HubSpot) but it needs no DNS coordination.

Until one of these happens, `learn` keeps serving the old KB and the same content
exists on both hosts. That is a duplicate-content overlap, not a penalty: `learn`
has the history and will keep the rankings, and authority consolidates onto `help`
as soon as the 301s are in place. This is the reason to prioritize the HubSpot
action rather than let it sit.

## Current state

| Thing | State |
|---|---|
| `help.sessionboard.com` | **Live.** Worker Custom Domain → `sessionboard-docs`; DNS `AAAA → 100::` (the no-origin placeholder wrangler creates — there is no origin to fail) |
| `learn.sessionboard.com` DNS | CNAME → `657654.group4.sites.hubspot.net`, **DNS-only** (HubSpot KB, still live) |
| `sessionboard.com` zone | On Cloudflare, same account as this Worker (`7ada9117…`) |
| Canonicals / OG / sitemap | Emit `https://help.sessionboard.com/...` |
| Redirect map | 265 live slugs in `redirects-map.json`; matches on exact slug, numeric-prefix-stripped slug, then numeric article ID; unknown slugs → FAQ contact page; `/en/knowledge-base` root → `/`; `/sitemap.xml` → Starlight sitemap |
| robots.txt | Served by the Worker: allowlist/denylist policy + Sitemap on `help.…` and `learn.…`; `Disallow: /` + `X-Robots-Tag: noindex` on the workers.dev preview host |
| Analytics | GA4 `G-Y3H82ZJMKG` + GTM `GTM-T69ZL692` (same container as www), cross-domain linker includes both `help.` and `learn.` |

## Why this domain

`help.` is the better name regardless — it says what the site is, and `learn.`
was inherited from HubSpot rather than chosen. Both are subdomains of the
marketing site, so GA4 cross-domain linking and the GSC domain property
(`sc-domain:sessionboard.com`) cover them with no new setup.

The original argument for `learn.` was avoiding redirect debt, since every inbound
link and Google result points there. That argument still holds — it is exactly why
`learn` must end up 301ing to `help` rather than being abandoned.

## What shipped on 2026-08-07

1. **Pushed the repo to GitHub** (26 commits) so Docs CI gates every future edit.
2. **Bound `help.sessionboard.com`** to the Worker as a Custom Domain and deployed
   the full build (228 pages, 1,740 assets).
3. **Made `help` the canonical host** — `astro.config.mjs` `site`, the JSON-LD and
   canonical tags in `Head.astro`, the GA4 cross-domain linker, the share-image
   footer label, and `PROD_HOST` in `worker.js`. All 228 OG images regenerated.
4. **Verified the whole legacy URL surface** against the live host:
   **311/311 resolve 301 → 200**, 0 failures.
5. **Purged the zone cache** for the hostname, so no pre-cutover `noindex`
   response can be served to a crawler.
6. **Attempted and rolled back the `learn` takeover** — see the blocker above.

## What remains

1. **HubSpot admin: release `learn.sessionboard.com`** — the one real blocker.
   Two options, both in [the blocker section](#to-finish-the-cutover-hubspot-admin-required).
2. **Freeze HubSpot KB authoring** — announce to the support team; new and edited
   articles land in this repo instead (PR + CI). Until this happens, HubSpot edits
   are invisible on `help`.
3. **Point Breeze at the new domain** — can be done now, `help` is publicly
   crawlable (see below).
4. **Cloudflare bot + rate-limit rules** — see "Still to do" under Crawler policy.
5. **HubSpot cleanup**, after the domain is released:
   - Archive the KB articles (keeps history, removes their internal search/AI surfaces).
   - Update Service Hub assets linking to old KB URLs — chat snippets, bot flows,
     email templates, help-widget links. Old links still 301, but native links
     avoid the hop.
6. **In-app links — no code change required.** 83 references across
   `web-ui-v2` / `web-ui` / `web-api` resolve to 23 unique legacy KB URLs, all of
   which 301 to the correct new article. Repointing them to native `help.` paths
   removes one hop and is a nice-to-have. `docusign-integration` (`web-ui-v2`
   OrgSettings integrations) **404s in HubSpot today** — the Worker improves it to
   the support page. The real fix is writing that article; see
   `PRODUCT-DELTA-AUDIT.md`.

### Smoke test (re-run after any deploy)

```bash
npm run audit:redirects                      # 311 legacy URLs, exits non-zero on failure
curl -sI https://help.sessionboard.com/ | grep -i x-robots   # must be empty
curl -s  https://help.sessionboard.com/robots.txt | tail -2  # Sitemap on help.
curl -s -o /dev/null -w '%{http_code}\n' -A GPTBot https://help.sessionboard.com/   # 403
```

Then spot-check GA4 realtime for `page_view` events from `help.sessionboard.com`.

### Support chat (Breeze AI) — can be done now

This is how the Help Center replaces HubSpot KB as the answer source for chat.
**Breeze Customer Agent can crawl a public domain**, so no article-by-article sync
and no keeping a shadow copy in HubSpot.

`help.sessionboard.com` is live and publicly crawlable, and `HubSpot` is on the
Worker's allowlist, so this no longer waits on the `learn` cutover.

Setup (Service → **Customer Agent** → **Train → Knowledge** → **Add content**):

1. **Import from public URLs** → `https://help.sessionboard.com`
   - Toggle **Import related URLs** ON (crawls up to 5,000 URLs; we have 228).
   - **Which pages to import** → **This subdomain only** (excludes `www` and the
     marketing site, which the Marketing Site Chatflow already covers).
   - Leave **citations ON** so answers link customers to the real article.
2. **Remove the HubSpot Knowledge Base source** in the same screen once the KB is
   archived. If both remain, the agent will answer from — and cite — articles on a
   domain we are retiring.
3. Assign the agent on the chatflow that should use it. The Help Desk inbox already
   has two inactive **AI Agent Tester** Live Chat flows to validate on before
   pointing **Support Chatflow** at it.
4. Re-crawl cadence is **weekly, automatic**. After a large docs push, hit
   **Refresh** on the imported URL source instead of waiting.

Note the crawler only reads publicly accessible pages, so point it at `help.` and
not at the workers.dev preview host, which serves `Disallow: /` and
`X-Robots-Tag: noindex` (see `worker.js`).

Also update the **canned chat snippets and bot flows** that paste old KB links.
They still 301 correctly, so this is cleanup, not a blocker.

### T-plus 1–2 weeks
12. `gsc_health_check.py` — watch for index coverage issues, soft-404s, and the
    redirect pages dropping out of the index in favor of the new paths.
13. Watch Worker analytics for the fallback redirect (unknown slugs) — a spike means
    a slug pattern we missed; add it to `redirects-301.csv` and redeploy.
14. GA4: compare Help Center sessions vs. the HubSpot KB baseline; confirm
    `help-center` UTM demo clicks appear in HubSpot attribution.

## 301 audit — the full URL surface (2026-08-07)

The article export is not the URL surface. Enumerating from four independent
sources found **291** legacy URLs, ~70 more than the 220 articles we had mapped:

| Source | URLs | Why it finds things the others miss |
|---|---|---|
| Live HubSpot sitemap | 222 | Ground truth for what HubSpot serves *today* |
| Google Search Console (16 mo) | 270 | Catches indexed URLs HubSpot **omits** from its sitemap — including category pages and deleted articles |
| Semrush `backlinks_pages` | ~250 | Catches URLs with **external backlinks**, i.e. the ones whose authority we'd forfeit |
| `rg` over web-api / web-ui-v2 / web-ui | 23 | In-product help links, which no crawler can see |

**Result: 311 of 311 resolve 301 → 200 — zero failures.** (311 rather than 291
because the sweep also drives every historical slug in `redirects-301.csv`,
including drafts and archived articles.) Eleven fall through to the
contact-support page: eight are HubSpot `-temporary-slug-<uuid>` placeholders and
three are ambiguous draft slugs — all verified **404 in HubSpot today**, so a
support page is a strict improvement over what a visitor gets now.

HubSpot-hosted `/hs-fs/hubfs/` **images** (3 URLs, ≈5 impressions in 16 months)
are excluded by design — redirecting an image request to an HTML page is worse
than letting it fail.

### What only this audit caught

- **9 KB category pages** — `frequently-asked-questions`, `training-videos`,
  `product-release-notes`, `portal-users`, `integrations`,
  `feature-overview-guides`, `sessionboard-how-tos`,
  `understanding-sessionboard-terms-roles`, `kb-search-results`. Live and
  ranking, but not articles, so they were **absent from the export entirely**.
  Four new section hubs (`/faq/overview`, `/videos/overview`,
  `/release-notes/overview`, `/participants/overview`) were written to give them
  honest targets — which also closes the long-standing "sidebar groups aren't
  clickable" gap and gives us category-level pages to rank.
- **`/en/migrated/knowledge-base/…`** — a live path prefix from an *earlier*
  HubSpot migration that Google still has indexed.
- **HubSpot's own slug renames** — `6284057-create-assign-tasks` →
  `6284057-assign-tasks`. The Worker now indexes on the **numeric article ID**,
  so a rename resolves without anyone noticing it happened.
- **HubSpot serving broken 301s** — two articles redirect to a doubled
  `/en/knowledge-base/en/knowledge-base/<slug>` path that 404s. Normalized.
- **17 URLs** that previously fell through to the contact-support FAQ now land on
  their nearest published article (mostly participant portal docs).

### Traffic baseline — read this before judging the migration

One article, `8103124-why-does-my-computer-say-this-site-can-t-be-reached`, was
**59% of all KB clicks** (4,905 of 8,256) and 63% of impressions over 16 months.
It ranked for the generic Chrome error string — not for anything about events, at
a 0.6% CTR. The team unpublished and `noindex`ed it around **April 2026**, and it
has produced **0 clicks in the last 30 days**.

So the pre-cutover baseline to measure against is **~262 clicks / 30 days**
(782 / 90 days), *not* the 16-month total. Comparing post-launch numbers to the
16-month figure would show a fake ~60% collapse that happened months ago and had
nothing to do with this migration.

### Re-run it

The whole audit is `scripts/audit_redirects.py`, registered in the agent toolbelt
([`AGENT_TOOLBELT.md`](../sessionboard-tam/growth-org/AGENT_TOOLBELT.md) §9) so
it gets re-run as part of doing the work rather than as a step someone has to
remember. It exits non-zero if any legacy URL fails to reach a live page. No
credentials or venv to set up.

```bash
cd sessionboard-docs
npm run build && node scripts/redirects-to-map.mjs   # targets validated against dist/
npm run audit:redirects                              # defaults to help.sessionboard.com
npm run audit:redirects -- --base https://learn.sessionboard.com   # once HubSpot releases learn
```

The second run only becomes meaningful after the `learn` blocker is cleared; it
confirms our Worker is answering on that host rather than HubSpot.

## Crawler policy — rank in search, don't feed competitors

The goal is asymmetric: stay visible to engines that send readers back to us,
while denying the bulk-copy paths a competitor would actually use.

**There is no version of this where the docs rank but cannot be read.** Ranking in
Google and being cited by ChatGPT/Perplexity both require those crawlers to fetch
the full page text, and anything they can fetch, a person can fetch. So the lever
is not *whether* content is readable — it is *who* gets to read it, *how cheaply*,
and *at what volume*.

### What the Worker enforces (live)

| Class | Examples | Treatment |
|---|---|---|
| Search engines | Googlebot, Bingbot, Applebot, DuckDuckBot | Allowed |
| AI engines that cite + link | OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Google-Extended | Allowed |
| Our own tooling | SemrushBot, SiteAuditBot, HubSpot (Breeze) | Allowed |
| AI training corpora | GPTBot, ClaudeBot, CCBot, Bytespider, Meta-ExternalAgent | **403 at edge** |
| Competitor recon | AhrefsBot, DataForSeoBot, MJ12bot, Diffbot, ZoominfoBot, Scrapy | **403 at edge** |
| Bulk exports | `/llms.txt`, `/llms-full.txt`, `/llms-small.txt` | **404 for everyone** |

Two deliberate choices worth knowing about:

- **`GPTBot` blocked, `OAI-SearchBot` allowed.** OpenAI uses separate agents for
  model training and for the index behind ChatGPT search citations. Same split for
  `ClaudeBot` vs. `Claude-SearchBot`. We keep every citation path and give up only
  the training copy. `Google-Extended` stays allowed because it powers Gemini
  grounding, which cites; it has no bearing on Search rank either way.
- **The `llms-*.txt` dumps are the real exposure**, not the HTML. They are the whole
  Help Center in one GET — the single most valuable thing on the domain to a
  competitor, and cheaper for them than crawling 224 pages. Google has said it does
  not use `llms.txt`, so withholding them costs no ranking. We still generate them:
  `dist/llms-small.txt` is what we upload to Breeze, and it is the corpus for our
  own chat later. They just aren't fetchable from the internet.

The denylist is enforced by User-Agent at the edge, not only in `robots.txt`, because
`robots.txt` is advisory. Both lists live in one place: `ALLOWED_BOTS` / `BLOCKED_BOTS`
in `worker.js`. Adding a crawler means adding one string.

`robots.txt` leaves the default `User-agent: *` group on `Allow: /` (pages only,
never the dumps). A blanket `Disallow: /` would be the intuitive move, but it buys
nothing — a competitor scraping us ignores `robots.txt` entirely — while risking the
silent loss of a search surface that matters later, since new AI engines appear
faster than we would notice adding them to an allowlist. The teeth are at the edge.

### Still to do (needs Cloudflare dashboard access, at cutover)

The Worker stops crawlers that identify themselves honestly. A determined competitor
will send a browser User-Agent instead, and only volume-based controls catch that.
On the `sessionboard.com` zone, for `help.sessionboard.com/*`:

1. **Security → Bots → Block AI Scrapers and Crawlers: ON.** Cloudflare's own
   maintained list, updated far more often than ours, and it verifies bots by
   signature rather than trusting the User-Agent string.
2. **Rate limiting rule:** >120 requests/minute per IP → managed challenge. Normal
   readers hit a handful of pages; a full-site scrape is hundreds in a minute.
   Exempt verified bots (`cf.client.bot`) so Googlebot is never throttled.
3. **Bot Fight Mode: ON** — challenges headless/automated clients that spoof a
   browser UA.

Skipping these leaves the policy roughly as strong as `robots.txt` alone against
anyone acting in bad faith. The site is live, so these are outstanding now rather
than scheduled.

## Rollback

**`help.sessionboard.com`** is a new hostname that never served anything else, so
there is nothing to roll back to — reverting means deleting the Custom Domain
(`npx wrangler deploy` with the `[[routes]]` block removed), which takes the Help
Center offline rather than restoring a previous state. Roll forward instead.

**`learn.sessionboard.com`** is untouched and still served by HubSpot. If a future
cutover attempt breaks it, restore the original record — `CNAME` →
`657654.group4.sites.hubspot.net`, **DNS only** (grey cloud), TTL 3600 — and
remove the Worker route. That is the exact state it is in today, and it recovers
within seconds.

## Known gaps / accepted risks

- **HubSpot KB search URLs** (`/en/knowledge-base?q=…` etc.) → redirect to `/` root;
  acceptable, Pagefind search is on every page.
- **Article slugs renamed inside HubSpot after the last sync** are largely absorbed:
  the Worker falls back to matching on the numeric article ID, which HubSpot keeps
  across renames. A slug renamed *and* re-IDed would still miss and hit the FAQ
  fallback — the authoring freeze closes that.
- **The same content is live on both `help` and `learn`** until HubSpot releases the
  domain. Duplicate content across hosts is not penalized, but `learn` holds the
  history and will keep the rankings, so `help` will not rank meaningfully until the
  301s are in place. This is the cost of launching before the HubSpot action, and it
  is recoverable in full once the redirect exists.
- **`help.sessionboard.com` has no origin** (`AAAA → 100::`). If the Worker is ever
  deleted or its Custom Domain unbound, the hostname fails closed rather than
  serving something stale. That is the intended trade.
