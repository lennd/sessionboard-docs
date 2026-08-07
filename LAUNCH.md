# Launch plan — learn.sessionboard.com cutover

The new Help Center takes over **learn.sessionboard.com** — the exact domain the
HubSpot Knowledge Base lives on today. This is deliberate: every legacy article
URL (`learn.sessionboard.com/en/knowledge-base/<slug>`) keeps its domain and only
needs a **path-level 301** served by our own Worker. No cross-domain redirects, no
HubSpot URL-mapping tool, no SEO authority split.

## Launch readiness (verified 2026-08-06)

| Gate | State |
|---|---|
| Content parity with live HubSpot KB | ✅ 220/220 published articles live in the build; 0 missing |
| Legacy URL → new article 301s | ✅ all 220 verified end-to-end through the Worker |
| In-app help links keep working | ✅ 24/25 resolve; the 25th 404s in HubSpot today |
| Build / link validation | ✅ 224 pages, 0 broken internal links |
| Push to GitHub so Docs CI gates edits | ⬜ **21 commits unpushed** |
| HubSpot KB authoring freeze announced | ⬜ needs support team |
| DNS flip + Worker route | ⬜ needs Cloudflare change (≈15 min) |
| Breeze agent repointed at new domain | ⬜ do at cutover (see below) |
| Crawler policy (search/AEO in, scrapers out) | ✅ enforced in the Worker; ⬜ Cloudflare bot + rate-limit rules at cutover |

Nothing on the content or redirect side is blocking. The remaining gates are a
push, a team announcement, and a 15-minute DNS change.

## Current state (verified 2026-08-03)

| Thing | State |
|---|---|
| `learn.sessionboard.com` DNS | CNAME → `657654.group4.sites.hubspot.net` (HubSpot KB, live) |
| `sessionboard.com` zone | On Cloudflare, same account as this Worker (`7ada9117…`) |
| New site | Deployed at `sessionboard-docs.sessionboard.workers.dev` (noindexed) |
| Canonicals / OG / sitemap | Already emit `https://learn.sessionboard.com/...` |
| Redirect map | 220 live slugs in `redirects-map.json`; prefix-insensitive matching (`9156219-cvent-integration` ≡ `cvent-integration`); unknown slugs → FAQ contact page; `/en/knowledge-base` root → `/`; `/sitemap.xml` → Starlight sitemap |
| robots.txt | Served by the Worker: allowlist/denylist policy + Sitemap on `learn.…`, `Disallow: /` + `X-Robots-Tag: noindex` everywhere else. See "Crawler policy" below |
| Analytics | GA4 `G-Y3H82ZJMKG` + GTM `GTM-T69ZL692` (same container as www), cross-domain linker includes `learn.sessionboard.com` |

## Why this domain

- **Zero redirect debt for the domain itself** — all inbound links, chat snippets,
  and Google results already point at `learn.sessionboard.com`.
- **Subdomain of the marketing site** — GA4 cross-domain linker and GSC domain
  property (`sc-domain:sessionboard.com`) cover it without new setup.
- `docs.` / `help.` were considered and rejected: they'd force cross-domain 301s
  from a domain we'd still have to keep pointed at something.

## Cutover runbook

Total downtime: none (DNS flip; both origins serve HTTPS).
Best window: low-traffic weekday morning, US time, with an hour of attention after.

### T-minus 1 week
1. **Freeze HubSpot KB authoring** — announce to support team; new/edited articles
   after the freeze must land in this repo instead (PR + CI).
2. **Final parity sync** — re-run the audit (`MIGRATION.md` § parity audit) against
   the live KB; import any articles published since the last sync
   (`scripts/hubspot-article-to-md.py`), regenerate share images (`npm run og`),
   rebuild redirect map (`node scripts/redirects-to-map.mjs`).
3. **Push repo to GitHub** so Docs CI gates future edits.

### Cutover day (≈15 minutes of work)
4. **Deploy latest build** to the Worker (`npm run build && npx wrangler deploy`).
5. **Enable the route** — in `wrangler.toml` uncomment:
   ```toml
   [[routes]]
   pattern = "learn.sessionboard.com/*"
   zone_name = "sessionboard.com"
   ```
   and `npx wrangler deploy` again.
6. **Flip DNS** — in the Cloudflare `sessionboard.com` zone, set the `learn`
   CNAME to **Proxied** (orange cloud). Target can stay `657654.group4.sites.hubspot.net`;
   once proxied, the Worker route intercepts every request before it reaches HubSpot.
7. **Smoke test** (all should pass within minutes of the DNS TTL):
   - `https://learn.sessionboard.com/` → new home page
   - `https://learn.sessionboard.com/en/knowledge-base/9156219-cvent-integration` → 301 → `/integrations/cvent`
   - Same URL **without** the numeric prefix → same 301
   - Unknown slug → 301 → `/faq/who-can-i-contact-for-additional-assistance`
   - `/robots.txt` → allow-all + sitemap; `/sitemap.xml` → sitemap index
   - Spot-check GA4 realtime for page_view events from the new domain
8. **Purge Cloudflare cache** for the zone (old HubSpot HTML may be edge-cached).

### T-plus same day
9. **GSC**: verify `learn.sessionboard.com` is covered (domain property
   `sc-domain:sessionboard.com` covers it; otherwise add URL-prefix property), then
   submit the sitemap:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=~/keys/sessionboard-ga4-mcp.json
   python3 ../sessionboard-tam/scripts/gsc_submit_sitemap.py --sitemap sitemap.xml  # against learn property
   ```
10. **HubSpot cleanup**:
    - Content Settings → remove `learn` subdomain from the Knowledge Base content type
      (prevents HubSpot serving a competing copy at any hostname).
    - Archive the KB articles in HubSpot (keeps history, removes their internal search/AI surfaces).
    - Update Service Hub assets that link to old KB URLs — chat snippets, bot flows,
      email templates, help-widget links. (Old links still 301 correctly, but native
      links avoid the hop.)
11. **In-app links — no code change required.** 83 references across
    `web-ui-v2` / `web-ui` / `web-api` resolve to 25 unique legacy KB URLs; all
    24 that exist today 301 to the correct new article (verified 2026-08-06).
    Repointing them to native paths is a nice-to-have that removes one hop.
    The 25th, `docusign-integration` (`web-ui-v2` OrgSettings integrations),
    **404s in HubSpot today** — the Worker improves it to the support page.
    Real fix is writing that article; see `PRODUCT-DELTA-AUDIT.md`.

### Support chat (Breeze AI) — do this at cutover, not after

This is how the Help Center replaces HubSpot KB as the answer source for chat.
**Breeze Customer Agent can crawl a public domain**, so no article-by-article sync
and no keeping a shadow copy in HubSpot.

Setup (Service → **Customer Agent** → **Train → Knowledge** → **Add content**):

1. **Import from public URLs** → `https://learn.sessionboard.com`
   - Toggle **Import related URLs** ON (crawls up to 5,000 URLs; we have ~224).
   - **Which pages to import** → **This subdomain only** (excludes `www` and the
     marketing site, which the Marketing Site Chatflow already covers).
   - Leave **citations ON** so answers link customers to the real article.
2. **Remove the HubSpot Knowledge Base source** in the same screen once the KB is
   archived. If both remain, the agent will answer from — and cite — archived
   articles that now 301 elsewhere.
3. Assign the agent on the chatflow that should use it. The Help Desk inbox already
   has two inactive **AI Agent Tester** Live Chat flows to validate on before
   pointing **Support Chatflow** at it.
4. Re-crawl cadence is **weekly, automatic**. After a large docs push, hit
   **Refresh** on the imported URL source instead of waiting.

Ordering matters: the crawler only reads publicly accessible pages, and every
non-`learn` host serves `Disallow: /` + `X-Robots-Tag: noindex` (see `worker.js`).
So the crawl cannot be configured until the domain is cut over. To evaluate the
agent **before** cutover, upload `dist/llms-small.txt` as a file source (`.txt` is
supported) — it is the whole Help Center as one document, regenerated on every build.

Also update the **canned chat snippets and bot flows** that paste old KB links.
They still 301 correctly, so this is cleanup, not a blocker.

### T-plus 1–2 weeks
12. `gsc_health_check.py` — watch for index coverage issues, soft-404s, and the
    redirect pages dropping out of the index in favor of the new paths.
13. Watch Worker analytics for the fallback redirect (unknown slugs) — a spike means
    a slug pattern we missed; add it to `redirects-301.csv` and redeploy.
14. GA4: compare Help Center sessions vs. the HubSpot KB baseline; confirm
    `help-center` UTM demo clicks appear in HubSpot attribution.

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
On the `sessionboard.com` zone, for `learn.sessionboard.com/*`:

1. **Security → Bots → Block AI Scrapers and Crawlers: ON.** Cloudflare's own
   maintained list, updated far more often than ours, and it verifies bots by
   signature rather than trusting the User-Agent string.
2. **Rate limiting rule:** >120 requests/minute per IP → managed challenge. Normal
   readers hit a handful of pages; a full-site scrape is hundreds in a minute.
   Exempt verified bots (`cf.client.bot`) so Googlebot is never throttled.
3. **Bot Fight Mode: ON** — challenges headless/automated clients that spoof a
   browser UA.

Skipping these leaves the policy roughly as strong as `robots.txt` alone against
anyone acting in bad faith. Do them the same day as the DNS flip.

## Rollback

Flip the `learn` DNS record back to **DNS only** (grey cloud) — traffic returns to
HubSpot unchanged. Remove/disable the Worker route. Nothing in HubSpot is deleted
until T-plus cleanup, so rollback is instant during the watch window.

## Known gaps / accepted risks

- **HubSpot KB search URLs** (`/en/knowledge-base?q=…` etc.) → redirect to `/` root;
  acceptable, Pagefind search is on every page.
- **Article slugs renamed inside HubSpot after the last sync** would miss the map and
  hit the FAQ fallback — mitigated by the T-minus-1-week freeze + final sync.
- **learn.sessionboard.com HTTPS during flip**: proxied Cloudflare cert covers the
  subdomain (universal SSL); no cert provisioning wait.
