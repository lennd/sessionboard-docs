# Launch plan — learn.sessionboard.com cutover

The new Help Center takes over **learn.sessionboard.com** — the exact domain the
HubSpot Knowledge Base lives on today. This is deliberate: every legacy article
URL (`learn.sessionboard.com/en/knowledge-base/<slug>`) keeps its domain and only
needs a **path-level 301** served by our own Worker. No cross-domain redirects, no
HubSpot URL-mapping tool, no SEO authority split.

## Current state (verified 2026-08-03)

| Thing | State |
|---|---|
| `learn.sessionboard.com` DNS | CNAME → `657654.group4.sites.hubspot.net` (HubSpot KB, live) |
| `sessionboard.com` zone | On Cloudflare, same account as this Worker (`7ada9117…`) |
| New site | Deployed at `sessionboard-docs.sessionboard.workers.dev` (noindexed) |
| Canonicals / OG / sitemap | Already emit `https://learn.sessionboard.com/...` |
| Redirect map | 220 live slugs in `redirects-map.json`; prefix-insensitive matching (`9156219-cvent-integration` ≡ `cvent-integration`); unknown slugs → FAQ contact page; `/en/knowledge-base` root → `/`; `/sitemap.xml` → Starlight sitemap |
| robots.txt | Served by the Worker: allow-all + Sitemap on `learn.…`, `Disallow: /` + `X-Robots-Tag: noindex` everywhere else |
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
11. **Update in-app links** — grep web-ui-v2 / web-api emails for
    `learn.sessionboard.com/en/knowledge-base` and repoint to new paths.

### T-plus 1–2 weeks
12. `gsc_health_check.py` — watch for index coverage issues, soft-404s, and the
    redirect pages dropping out of the index in favor of the new paths.
13. Watch Worker analytics for the fallback redirect (unknown slugs) — a spike means
    a slug pattern we missed; add it to `redirects-301.csv` and redeploy.
14. GA4: compare Help Center sessions vs. the HubSpot KB baseline; confirm
    `help-center` UTM demo clicks appear in HubSpot attribution.

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
