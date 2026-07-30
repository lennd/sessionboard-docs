# Sessionboard docs — project instructions

## About this project

- Documentation site for **Sessionboard**, built on [Mintlify](https://mintlify.com).
- Pages are MDX files with YAML frontmatter; configuration lives in `docs.json`.
- This site is being migrated from the HubSpot Knowledge Base at `learn.sessionboard.com`. See `MIGRATION.md` for the full old→new article map.
- Use the Mintlify MCP server (`https://mcp.mintlify.com`) to edit content and settings via MCP.

## Information architecture

Docs are organized **audience-first, then by product module** (not by the old HubSpot categories):

- **Documentation** tab — organizer/admin guides, one group per product area (Sessions, Speakers, Evaluations, Speaker CRM, Awards, Sponsors & Exhibitors, Portals, Contacts, Communications, Reporting & Insights, Program Site).
- **Participant guide** tab — end-user docs for speakers/sponsors/exhibitors using portals.
- **Integrations & API** tab — connectors, webhooks, Public API, and MCP.
- **FAQ** tab — troubleshooting and common questions.

When adding a page, place it in the folder matching its product area and add it to the matching group in `docs.json`.

## Terminology

- "Session" (not "talk" or "presentation"); "Submission form" for the call-for-papers form.
- "Speaker CRM" for the org-level relationship product; "Contacts" for the event-level module.
- "Portal" = participant self-service hub; "Program Site" = the Enterprise single-URL hub.
- Use "they/them" for generic participants.

## Style preferences

- Active voice, second person ("you"). One idea per sentence.
- Sentence case for headings.
- Bold for UI elements: Click **Settings**. Code formatting for paths, fields, and code.
- Prefer Mintlify components: `<Steps>` for procedures, `<Tabs>`/`<AccordionGroup>` for alternatives and FAQs, `<CardGroup>` for navigation, `<Note>`/`<Tip>`/`<Warning>` for callouts.
- Screenshots from the old KB are not yet migrated. Where a visual is needed, leave a short note so CS can add the image.

## Content boundaries

- Don't document internal-only admin/superuser tooling.
- Add-on features (Speaker CRM, Awards, SSO, Insights, Program Site) should note they require enablement via support@sessionboard.com.
