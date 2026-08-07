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

## Apr–Aug 2026 platform delta — Aug 7, 2026

A second, wider sweep: every user-facing change in `sessionboard-web-api`
(~419 commits, ~400 migrations) and `sessionboard-web-ui-v2` (~590 non-merge
commits) between 2026-04-01 and 2026-08-07.

### Two claims that did not survive verification

The sweep surfaced both of these as shipped capabilities. Neither is, and
documenting them would have been actively wrong.

| Claimed | Reality | Evidence |
|---|---|---|
| **Public API rate limits** — 100 req/15 min for new tokens, 1000 for grandfathered ones | **Not implemented.** The migration adds a `rate_limit` column and nothing reads it. The model does not even expose the field, and the commit is titled `chore: add rate_limit column`. No enforcement, no 429 path. | `web-api db/migrations/20260411120000-add-rate-limit-to-api-tokens.js`; absent from `models/organization/organization_api_token.js`; no consumer anywhere in the repo |
| **Org admins can require 2FA** for all members | **Staff-operated, not self-serve.** The toggle is real and works, but it renders inside the **Admin Settings** tab, which is `adminOnly` and gated on `useSuperUser()`. No customer admin can reach it. | `web-ui-v2 OrgSettings.tsx` (`showAdminSettings={useSuperUser()}`), `SettingsNav.tsx` (`{ id: 'admin', adminOnly: true }`), `AdminSettings.tsx:850` renders `<SecuritySettings />` |

### Fixed in this pass

| # | Delta | Docs change | Product evidence |
|---|-------|-------------|------------------|
| 6 | Org-wide 2FA enforcement shipped (May 2026) and the 2FA article did not mention it — while asserting "your event organizer has enabled 2FA as a requirement" as though it were universal | `get-started/how-to-set-up-two-factor-authentication-2fa-...mdx` — added a **When 2FA is required for everyone** section stating the enforcement scope (org + all child events, prompt on next sign-in) and routing admins to support, since the control is staff-only. Rewrote the grayed-out-toggle FAQ answer to match. | `web-api db/migrations/20260501000001-add-require-two-factor-to-organizations.js`, `services/organizations/methods/security/{get,put}.js`, `two_factor_required` in `/user/me`; copy verified verbatim from `web-ui-v2 public/locales/en/admin.json` `security.enforce.*` |
| 7 | Same article's setup instructions were broken by the HubSpot export — "Step 2/3/4" were bare paragraphs, so only step 1 was a heading and the sequence was invisible | Converted to `<Steps>`, sentence-cased the remaining Title Case headings, replaced the emoji contact footer | — |
| 8 | 106 image alt texts were prefixed with a page title that no longer exists, orphaned by the title rename pass | Prefixes stripped across 22 files; `scripts/check-style.mjs` now fails on any alt prefix >24 chars that is not the current page title, so a future rename cannot orphan them again | — |

### Verified real, not yet documented (ranked backlog)

Each of these was checked against source and is genuinely customer-reachable.
None is written yet.

| Priority | Feature | Verified evidence | Why it matters |
|---|---|---|---|
| 1 | **Notifications & Messaging** — bell, inbox, per-type preferences, org policy, session Messages tab | `web-ui-v2 features/Notifications/`, `features/Messaging/SessionMessagesTab.tsx` | Self-serve Preview, org-wide, and entirely undocumented |
| 2 | **Early Access program** — join, Preview self-toggle vs Beta hand-raise | `pages/EarlyAccess/{EarlyAccessPage.tsx,data.ts}` | Now the front door to ~10 gated features the docs already reference |
| 3 | **Portal participation sections** (SB-8160) — custom section titles, show subsessions, hide Confirmed Participation | `Portals/components/steps/ConfigurationStep.tsx:355–419` | Changes what every speaker sees in the portal |
| 4 | **Session withdrawal** — "Allow Submission Withdrawal" + withdrawn state | `EventSettings/ParticipantAcceptanceSection.tsx`, `portal/methods/.../withdraw/put.js`, `notifications/triggers/session-withdrawn` | New participant-initiated action with an email trigger |
| 5 | **Cross-field character limits** on submission forms | `web-api services/utils/forms/cross-field-char-rules.js` (enforced, with a user-visible error string) | Submitters hit the error with no doc to explain it |
| 6 | **Magic links are now multi-use** — `revoked_at` replaces `used_at` as the validity gate | `db/migrations/20260729230000-magic-links-multi-use.js` | Directly contradicts existing "single-use link" troubleshooting advice |
| 7 | **SSO additions** — OAuth 2.0 Password (ROPC), OIDC PKCE, SAML AuthnRequest Binding | `OrgSettings/components/{SsoSettings,AddOidcConfigSidebar,AddSamlConfigSidebar}.tsx` | Admin configuration reference |
| 8 | **Abstain reason settings** in Awards rounds and evaluation plans | `Awards/Program/Rounds/Round/RoundSettings/RoundSettingsPage.tsx` | New reviewer-facing workflow |
| 9 | **Clone event branding** (SB-8014) — opt out of copying branding, post-clone audit banner | `CloneEventSidebar.tsx`, `BrandingCloneAuditBanner.tsx` | Prevents wrong logos going live in portals |
| 10 | **Integration Reporting tab** (SB-7648) — Incremental / Full refresh / Snapshot | `OrgSettings/components/ReportingStep.tsx` | Gated by `integration_reporting` |
| 11 | **Sessionboard Imports wizard** replacing CSVBox | `components/shared/NativeImportWizard.tsx` | Screenshots in every import article go stale when the flag flips |
| 12 | **Org Portal Forms & Tasks** | `pages/org/OrgPortalForms.tsx`, `features/OrgPortalTasks/` | Needs `crm` + `org_portal_tasks` |

### Confirmed not documentable (staff-only or stub)

Beyond the earlier list, the sweep confirmed these are **not** customer surfaces
despite looking shipped:

- **Community** (Discussions / Ideas / Roadmap) — super-user only; non-staff deep links bounce to the dashboard.
- **CFP invoice refunds** — Sessionboard super users only, not org event admins.
- **Voices** — super-admin / demo-first.
- **Sessions 2.0 preview route** — renders a flag on/off message, not a product surface.
- **Lite Event sub-pages** (Presenters, Recordings, Registration, Integrations) — stub "Coming in Wave 4+" panels.
- **Attend** — Early Access card is hidden from the catalog; locked upsell only.
- **Org Settings → Admin Settings tab** — entirely super-user gated, so nothing inside it (including 2FA enforcement) is a self-serve customer path.

## Method

1. Two codebase inventories (web-api services + limits/emails; web-ui-v2 features/labels).
2. Grep-level verification of every numeric or terminology claim before editing docs.
3. Only claims verified against source were changed; everything ambiguous is
   parked above rather than guessed at.
