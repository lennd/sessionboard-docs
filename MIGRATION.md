# HubSpot KB → docs-as-code: coverage & 301 map

Authoritative source: `hubspot-knowledge-base-export-2026-07-09.xlsx` (264 articles), plus live-sitemap parity audits.
Full machine-readable map (every article → new path): [`redirects-301.csv`](redirects-301.csv).

## Parity audit log

| Date | Result |
| --- | --- |
| 2026-08-06 | **Pre-launch parity audit — clean.** Live sitemap: 220 published articles; all 220 present in `redirects-301.csv` and live in the build (0 missing, 0 unmapped, 0 broken targets). Only HubSpot edit since the last audit was *Bizzabo* (2026-08-03), already synced. Fixed a redirect-map bug: `redirects-to-map.mjs` keyed slugs on the last path segment, so the 5 live slugs containing a slash (`video-accept/decline-sessions`, `video-resources/wiki-pages`, `can-i-email-my-event-team/evaluators`, `pp-i-want-to-give-colleagues-access-to-my-sponsors/exhibitor-portal`, `what-does-the-p-in-the-description/biography-text-box-mean`) fell through to the generic fallback. Verified end-to-end: all 220 legacy URLs 301 to their correct article. Content gaps closed: 3 pages that were image/video-only or had no description now have real text (`speaker-headshot-dos-and-donts`, `updated-portal`, `how-to-navigate-your-group-portal`) and alt text was added to all 845 images that lacked it. |
| 2026-08-03 | Live sitemap (220 articles) vs map: imported 1 new article (*Why am I not receiving emails?* → `/faq/why-am-i-not-receiving-emails`); re-synced 3 updated articles (*How are tasks ordered within the portal* — full feature rewrite for the new Task display order setting; *ADD ON: Custom Email Domain* — new Deliverability & Allowlisting section + FAQ; *Bizzabo* — Speaker Label mapping change + Custom Participant Roles section); removed *"Why does my computer say 'This site can't be reached'?"* (unpublished in HubSpot since export). Note: the live Custom Email Domain article ends mid-sentence in HubSpot (FAQ 3) — completed minimally here; fix the HubSpot source. |

## Coverage summary

| | Count |
| --- | --- |
| Total articles mapped (export + post-export additions) | 265 |
| Published in HubSpot (live sitemap, 2026-08-03) | 220 |
| **Live in this build** (imported + hand-migrated) | **220** |
| &nbsp;&nbsp;— hand-crafted (polished) | 35 |
| &nbsp;&nbsp;— bulk-imported | 186 |
| Draft (held — not published in HubSpot) | 44 |
| Archived in HubSpot | 10 |
| Unpublished after export (removed from build) | 1 |

Every published, non-archived article is **live in the Mintlify build** and reachable in the nav. Cross-links between articles have been rewritten to the new paths (0 broken links). Draft and archived articles are mapped but not published — see below.

## New IA = your admin nav

Articles are organized to mirror the **new admin nav** (org/event level):

- **Guides** → Get started · Core concepts · **Program** (Sessions · Speakers · Evaluations · Sponsors & exhibitors · Portals · Contacts) · **CRM** · **Marketing** (Email & SMS · Studio AI) · **Awards** · **CMS** · **Reports** · **Agents** · **Event Team** · **Settings**
- **Participant guide** → portal/end-user docs (was jumbled into admin docs in HubSpot)
- **Apps & API** → the App Marketplace (Integrations → Apps) + Developer (API, webhooks, MCP)
- **Help** → FAQ & troubleshooting · Video tutorials · Release notes

Routing used HubSpot's own Category/Subcategory (e.g. *Feature Overview Guides → Speaker CRM* → CRM tab).

## 301 redirects

`redirects-301.csv` is the complete map: `old_url → new_path` for every article. Generate 301s from it before cutting `learn.sessionboard.com` over. Draft/archived rows point at their intended new path (drafts) or should redirect to the nearest parent (archived).

## Drafts held for review (44)

These are **unpublished in HubSpot**, so they were not published into the new KB. Decide per item whether to finish + publish or drop. Files were not generated; content is in the export.

| How to view & edit my session submission form? | Portal Users | Portals (Legacy) |
| How to upload files and make comments? | Portal Users | Portals (Legacy) |
| (Updated) |  |  |
| What question is your article answering? |  |  |
| How to edit my application? | Portal Users | Portals (Legacy) |
| (PP)How to upload files and make comments? | Portal Users |  |
| Understanding Filtering Options in Portals | Frequently Asked Questions |  |
| How to view what tasks have been completed? | Frequently Asked Questions |  |
| Unique Contacts |  |  |
| Editing Uploaded Files in Sessionboard | Feature Overview Guides | Session File Management |
| Create A Sponsor & Exhibitor Intake Form | Feature Overview Guides | Exhibitors/Sponsors |
| Contacts Module Overview | Feature Overview Guides | Contacts Module |
| Updated Portal: Collect Documents/File Requests |  |  |
| Conflict Detection | Feature Overview Guides | Sessions Module |
| Portal Apperance Settings |  |  |
| I want to give colleagues access to my sponsors/exhibitor po | Portal Users | Portals (Legacy) |
| Understanding A Portal Task | Portal Users | Portals (Legacy) |
| Updated Portal: Exhibitor Intake Form | Feature Overview Guides | Exhibitors/Sponsors |
| How do I upload content to my session and make comments? | Portal Users | Portals (Legacy) |
| How to view and download files from my portal? | Portal Users | Portals (Legacy) |
| How to access additional event portals you are associated wi | Portal Users | Portals (Legacy) |
| Sponsor/Exhibitor Profile Form | Feature Overview Guides | General |
| Starter Guide: Portals 101 |  |  |
| Custom Field Mapping | Integrations |  |
| Updated Portal: Create & Assign Portal Forms |  |  |
| [Template] Month + Year Release Notes |  |  |
| Viewing Subsessions Within The Agenda (VIDEO) | Feature Overview Guides | General |
| Subscribe To Feed | Feature Overview Guides | General |
| How to view a wiki page within my portal? | Portal Users | Portals (Legacy) |
| How can I switch between a people portal and a group portal? | Portal Users | Portals (Legacy) |
| [VIDEO] Subsessions In The Speaker Portal | Feature Overview Guides | General |
| Updated Portal: Create & Assign Tasks | Feature Overview Guides |  |
| [VIDEO] Task Managment |  |  |
| How to Resize Contact Headshots in Sessionboard via Import | Frequently Asked Questions |  |
| What question is your article answering? |  |  |
| What is the difference between a People, Groups, and Session |  |  |
| Understanding Synchronization Between Sessionboard and ATS A |  |  |
| How to Update Your Presenter Bio in the Portal |  |  |
| Understanding File Collection |  |  |
| Integration Not Syncing? 11 Common Causes & Fixes | Troubleshooting |  |
| Integration Field Mapping Reference | Integrations |  |
| test |  |  |
| What question is your article answering? |  |  |
| Draft: Creating a Custom Portal for Declined Speakers |  |  |

## Archived in HubSpot (10)

| Create A Sponsor & Exhibitor Intake Form | Feature Overview Guides |
| Updated Portal: Collect Documents/File Requests |  |
| Conflict Detection | Feature Overview Guides |
| Portal Apperance Settings |  |
| Sponsor/Exhibitor Profile Form | Feature Overview Guides |
| Starter Guide: Portals 101 |  |
| Updated Portal: Create & Assign Portal Forms |  |
| Viewing Subsessions Within The Agenda (VIDEO) | Feature Overview Guides |
| [VIDEO] Subsessions In The Speaker Portal | Feature Overview Guides |
| Updated Portal: Create & Assign Tasks | Feature Overview Guides |

## Remaining cleanup for full go-live
1. **Screenshots** — image `src` still point at `hubdb`/`hubspotusercontent` URLs, so they render today; re-host under `/images/` (or regenerate via the E2E harness) before cutover so you don't depend on HubSpot.
2. **Auto-import polish** — bulk-converted pages are faithful but plain; a light editorial pass (headings, callouts, Steps components) will match the 35 hand-crafted pages. The 35 hand pages show the target quality bar.
3. **Per-app pages** — the App Marketplace overview lists every app; individual setup guides for the newer apps (Goldcast, BigMarker, Riverside, Descript, Vimeo, YouTube, Zoom, Canva, Adobe, Slack, NoteAffect) are still to be written.
4. **Videos** — 29 training-video pages are imported as their own group; ideally fold each into its topic page.
