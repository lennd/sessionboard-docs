# Sessionboard Help Center (Mintlify)

Proof-of-concept migration of the Sessionboard support docs from the HubSpot Knowledge Base (`learn.sessionboard.com`) to Mintlify (docs-as-code).

## What's here

- **220 published articles live** (35 hand-crafted + 185 bulk-imported from the HubSpot export), plus home, Agents, and App Marketplace overview pages — **223 MDX files**, build validated, **0 broken links**.
- A **new IA that mirrors the admin nav** (Guides → Program/CRM/Marketing/CMS/Awards/Reports/Agents/Event Team/Settings · Participant guide · Apps & API · Help) — see `docs.json`.
- **`redirects-301.csv`** — the complete `old_url → new_path` map for all 264 articles (drop-in for 301s).
- **`MIGRATION.md`** — coverage summary, IA rationale, and the 44 drafts / 10 archived held for review.
- **`AGENTS.md`** — instructions for agents/humans editing these docs.

The 35 hand-crafted pages (e.g. `sessions/`, `speaker-crm/pipeline`, `integrations/api-tokens`) show the target quality bar; the 185 bulk-imported pages are faithful conversions that keep their original screenshots (hosted on HubSpot's CDN, so they render) and need a light editorial pass.

## Run locally

```bash
npm i -g mint   # already installed here as `mint`
mint dev
```

Then open `http://localhost:3000`.

## Structure

```
docs.json                  # navigation, theme, branding, agent features
index.mdx                  # help-center home
get-started/  concepts/  events/  sessions/  speakers/  evaluations/
speaker-crm/  awards/  sponsors-exhibitors/  portals/  contacts/
communications/  reporting/  site/            # organizer/admin docs
participants/                                  # end-user portal docs
integrations/                                  # connectors, API, MCP, webhooks
faq/                                           # troubleshooting
```

## Notes on this POC

- **Branding colors** in `docs.json` (`#2563EB` blue) are a placeholder — swap for the exact Sessionboard brand hex. Logos in `/logo` are still the starter assets; replace with Sessionboard logos.
- **Screenshots** are not migrated yet; pages note where visuals belong.
- Content is faithful to the current KB as of migration, using Mintlify components (`Steps`, `Tabs`, `Accordion`, `CardGroup`, callouts).
- The remaining ~160 articles are mapped to their new home in `MIGRATION.md` for a mechanical full migration.
