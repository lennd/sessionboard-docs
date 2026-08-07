# Product-to-docs delta audit — Aug 3, 2026

Docs were diffed against the current state of `sessionboard-web-api` and
`sessionboard-web-ui-v2` (code inventories + targeted source verification).
Every claim below was verified against source before editing; file paths are
the evidence.

## Fixed in this pass

| # | Delta | Docs change | Product evidence |
|---|-------|-------------|------------------|
| 1 | Portal "Extend Task Deadline (up to 31 days)" is stale — the product now exposes a configurable **Final Deadline** (days after the original due date, default 7) | `portals/portals-101.mdx` updated | `web-ui-v2 src/features/Portals/components/steps/ConfigurationStep.tsx` (Extend Task Deadlines toggle + Final Deadline number input); `web-api models/config_set/config_set.js` (`days_after_deadline` default 7) |
| 2 | Automated-emails article listed only 10 email types; the system-notification registry defines ~36 fixed types + a 10-email awards suite (incl. 2FA codes, magic links, invoice receipts, scheduled report delivery, portal messages) | `communications/automated-emails.mdx` — added a complete categorized catalog (account/sign-in, sessions & forms, intake, awards, portal, evaluations, files & reports) | `web-api src/notifications/system-notification-registry.js` (source of truth, incl. locked vs. configurable) |
| 3 | History module doc covered only Emails/SMS/Audit; the module now also ships GA **Integrations** (sync history + per-run error summaries and API logs) and **Exports** (re-download previous exports) tabs | `communications/email-sms-history.mdx` — retitled, added Integrations and Exports sections | `web-ui-v2 src/features/History/components/EventHistoryView.tsx` (tab list; Reports/Imports/Trash/Spend are flagged or superuser-only — not documented), `SyncHistoryTable.tsx`, `IntegrationLogsTable.tsx`, `ExportsTable.tsx` |
| 4 | Max file size FAQ said **1.95 GB** — platform cap is now **5 GB**, with per-event lower limits configurable in Record Settings (headshots/logos default 5 MB when limited) | `faq/what-is-the-maximum-file-size-that-sessionboard-supports.mdx` rewritten | `web-ui-v2 src/lib/filestack.ts` (`PORTAL_LIBRARY_MAX_FILE_BYTES` = 5 GB), `RecordSettingsGeneralTab.tsx`; `web-api models/utils/content-settings.js` (`PLATFORM_MAX_UPLOAD_BYTES` = 5 GB) |
| 5 | The Documents module was renamed **Print** in the current nav (`/program/print`) | `documents/document-generation.mdx` intro + description updated to lead with Print | `web-ui-v2 src/lib/navRouteMap.ts` (`EventDocuments` → `/program/print`), `nav.documents` label = "Print", `adminHiddenFeatures.ts` (documents flag folded into `print_agenda`) |

## Verified correct (no change needed)

| Claim in docs | Verdict | Evidence |
|---------------|---------|----------|
| Speaker limit "up to 15 speakers per session" (`sessions/submission-forms.mdx`) | Correct — form builder input is min 1 / max 15, default 6 | `web-ui-v2 src/features/Sessions/components/formEditor/FormSettingsStep.tsx` (max=15) |
| Draft submission reminders "five days and one day before close" | Correct | `web-api bin/workers/handlers/cfp-reminders-handler.js` |
| 2FA doc covers passkeys, authenticator app (TOTP), email codes, recovery codes | Current | `get-started/how-to-set-up-two-factor-authentication-2fa-...mdx` matches `web-api services/two-factor/` |
| Terminology: "Submission form" (not CFP), "Speaker Label" | Clean across docs | grep audit |
| Sessions 2.0 form doc describes role-based participant limits (not the old speaker limit) | Current — matches v2 role capacity model | `applications/building-your-submission-form.mdx` vs `FormSettingsStep.tsx` (`hideSpeakerLimit` for v2) |
| Insights doc covers report scheduling (Daily/Weekly/Monthly, 5 recipients) and live share links | Current | `reporting/insights-ai.mdx` vs `web-ui-v2 src/features/Reports`, `SharedInsights` |
| Round-based evaluations doc: 4-step wizard (Overview → Rounds → Evaluators → Assignments), Funnel vs. Parallel rounds | Current — matches v2 exactly | `evaluations/setting-up-round-based-evaluations.mdx` vs `web-ui-v2 evalPlanV2Constants.ts` |
| Print agendas doc | Current | `marketing/print-agendas.mdx` vs `features/Documents` (print_agenda) |

## Marketing module pass — Aug 7, 2026

The Marketing module had 4 docs pages against ~15 shipped surfaces. Eleven
articles were added and the section was restructured to mirror the product's
Source & produce / Distribute / Set up grouping. Print and the agenda builder
moved to Program, and Remix moved to Agents, matching where they actually live.

Whole module is Early Access (`marketing` carries `beta: true`), so every page
carries a gating note. Dispatch needs a second flag on top of it.

**Documented as not-yet-working**, because these look finished in the UI and
would otherwise generate tickets:

| Surface | Reality | Where noted |
|---|---|---|
| Advocacy **Attendees** audience | Assign API throws "Attendees audience is not available yet" | `marketing/advocacy.mdx` warning |
| Advocacy conversions | Funnel and KPIs deliberately stop at Clicked | `marketing/advocacy.mdx` note |
| Dispatch **Source** dropdown | Not persisted; no auto-generation from it | `marketing/dispatch.mdx` warning |
| Plan **Publish** | Creates an Advocacy link only — no recipients, no notify, no LinkedIn post | `marketing/content-plan.mdx` warning |
| Create **Post to LinkedIn** | Clipboard + composer redirect, not an OAuth publish | `marketing/create.mdx` warning |
| Posts "ready to schedule" | No scheduling anywhere in Posts | `marketing/posts.mdx` |
| Clips **AI / Yours / Imported** tabs | All exports record as user clips, so the filter misleads | `marketing/clips.mdx` warning |

Skipped by decision (gated or unfinished, not customer-reachable): Voices,
Stories, Intelligence, Creators, and the demo-only clip detail page.

## Deltas identified — pending decision or GA confirmation

These are real product surfaces with **no docs coverage**. Most look
feature-gated or early-access; confirm GA status before writing articles.

| Feature | Signal | Notes for review |
|---------|--------|------------------|
| **Goldcast integration** | `web-api services/integrations/conferences/goldcast/` mounted; appears in v2 Apps catalog but referenced from `EarlyAccess/` and `featureUtils` | Not in the apps docs section. Add an integration article once GA. |
| **Portal Communication (messaging)** | `services/messaging/` — segmented message threads, digest notifications | Docs only cover file-request messages. |
| **Org Portal (external reviewer/awards site)** | `services/org-portal/` with magic-link auth | Awards docs mention reviewers but not the org-portal surface. |
| **Paid submission forms** | `cfp-invoice-receipt` email, PAYMENT step in public CFP flow | Only sponsor/exhibitor payments FAQ exists. Consider a "collect submission payments" article. |
| **Public CFP flow changes** | New "Your Information" submitter step (SB-8146), review + payment steps | `participants/` docs describe the older flow loosely; screenshots predate. |
| **InGo & Snöball integration articles** | Both have docs articles (from HubSpot), but the v2 Apps catalog lists both as **coming soon** cards; backend has an active SnoBall inbound webhook, and **no InGo service exists in web-api** | Verify with product whether these describe partner workflows that still function, or should be marked/removed. |
| **DocuSign / Contracts** | First in the v2 Integrations order but gated behind the `contracts` Early Access beta | No docs article — hold until GA. |
| **Multi-language portals** | Portal configuration now has "Enable multi-language portal" + auto-translate sub-options | `settings/language-variant.mdx` says "enabled upon request" — confirm current enablement path and update. |
| **Speaker CRM suite growth** | Pipeline, Accounts, Prospects/Scouting, Contracts, Requests — several are Early Access betas | Docs cover the core CRM set; hold beta surfaces (Scouting, Requests, Contracts) until GA. |
| **New Navigation (module groups Program/CRM/Marketing/CMS/Attend)** | Early Access preview | When GA, most screenshots and "navigate to X module" instructions will need a refresh pass. |
## Do NOT document (confirmed not live / internal)

- **EventSites** — shelved, never shipped (per repo guidance).
- **Export service** (`services/export/`) — deprecated, routes commented out.
- **MYS / Personify integrations** — config-only stubs.
- **Cvent Org integration** — in development.
- Internal surfaces: sandbox seeder, impersonation, CSM/billing-admin dashboards, dev-tools.

## Method

1. Two codebase inventories (web-api services + limits/emails; web-ui-v2 features/labels).
2. Grep-level verification of every numeric or terminology claim before editing docs.
3. Only claims verified against source were changed; everything ambiguous is
   parked above rather than guessed at.
