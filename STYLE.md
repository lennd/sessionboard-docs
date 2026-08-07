# Sessionboard docs style guide

The reference for every page in this repo — for humans and for agents drafting
docs automatically. Automated PRs that don't follow this guide don't merge.

## Voice

- Active voice, second person ("you"). One idea per sentence.
- Plain words. "Use", not "utilize". "Before", not "prior to".
- Lead with the outcome, then the steps. A reader skimming H2s should
  understand what the page covers.
- Sentence case for headings ("Create a session", not "Create A Session").
- Use "they/them" for a generic participant.
- Faithful beats polished: never invent UI labels, limits, or behavior. If you
  can't verify a detail against the product, leave a `{/* TODO: verify */}`
  comment rather than guessing.

## Terminology

| Use | Not |
| --- | --- |
| Session | talk, presentation |
| Submission form | CFP form, call-for-papers form |
| Speaker CRM | CRM (when meaning the org-level product) |
| Contacts | contacts module people (event-level module) |
| Portal | dashboard, hub (participant self-service) |
| Program Site | microsite, event site |
| Participant | end user, attendee (in portal contexts) |
| Event team | admins (when meaning invited team members) |

## Formatting

- Bold for UI elements the reader clicks or reads: Click **Settings**.
- `Code` for field names, paths, values, and identifiers.
- Use **History > Emails** style (`>` separators, bold) for nav paths.
- Numbered lists for sequences; bullets for unordered facts.
- Screenshots live in `public/images/` and are referenced as `/images/...` —
  never hotlink external hosts (CI fails the build if you do).
- Links between docs pages are root-relative without trailing slash:
  `[Merge duplicates](/contacts/merge-duplicates)`.

## Components

Import what you use from `@compat` (local) or `@astrojs/starlight/components`:

```mdx
import { Note, Steps, Step, AddOnNote } from '@compat';
import { Tabs, TabItem, CardGrid, LinkCard } from '@astrojs/starlight/components';
```

Decision table:

| You're writing... | Use | Don't use |
| --- | --- | --- |
| A caveat or side fact | `<Note>` | Bold "NOTE:" prose |
| A shortcut or best practice | `<Tip>` | |
| Destructive/irreversible behavior | `<Warning>` | `<Note>` |
| A feature needing enablement | `<AddOnNote feature="Awards" />` | Hand-written pricing notes |
| A numbered procedure with >2 steps | `<Steps><Step title="...">` | Long `1. 2. 3.` walls with screenshots inline |
| Two alternative paths (e.g. org vs event) | `<Tabs><TabItem label="...">` | Duplicated sections |
| A set of navigation links | `<CardGrid>` + `<LinkCard>` | Bullet lists of links |
| Collapsible FAQ answers | `<Accordion title="...">` | Nested headings |
| An auto-generated video clip | `<Walkthrough src title captions />` | Raw `<video>`/iframe |

Component sources: [src/components/compat/](src/components/compat/).

## Titles

The title is the H1, the `<title>`, the search result, and what an AI answer
engine quotes. The sidebar label is what people navigate by. They are different
jobs, so they are different fields.

- **Task pages: imperative, no question mark.** "Compress headshots", not "How to
  compress headshots?". A help center is already answering "how to" — the words
  are dead weight in every search result.
- **Genuine FAQ pages: ask the actual question**, question mark included. "What
  access do evaluators have?" earns its `?`. This is the one place question form
  is right, because it matches how the question is typed.
- **Never open with a narrative.** Not "I created a new contact. Why do I not see
  them in the speakers module?" — that is a support ticket, not a title.
- **Keep enablement and section names out of the title.** Not "Settings – email
  themes (enabled upon request)". The section is already in the URL and the
  breadcrumb; enablement belongs in `<AddOnNote>` or a `<Note>`.
- **Over ~48 characters, add a short `sidebar.label`** (about 3–5 words). Under
  that, skip the label — the title is already the right length for the nav.

## Structure

- **The first body heading is `##`.** The H1 comes from `title`. Pages that open
  at `###` came from HubSpot and render a broken outline.
- **Headings are sentence case** and are labels, not sentences. "There are two
  methods for unlocking an account:" is a paragraph — writing it as a heading
  puts a sentence in the table of contents.
- **Never paste a list of the page's own headings at the top.** Starlight renders
  a table of contents already; HubSpot's jump links do not survive migration and
  become a linkless duplicate.

## Images

- **Alt text describes the image**, not the page. "The Set Submission Limit
  setting in Form Settings", not "Building your submission form: Settings" and
  never "<page title> in Sessionboard".
- Filenames are not alt text. `Screenshot 2025-05-28 at 12.00.42 PM` tells a
  screen-reader user nothing.

`node scripts/check-style.mjs` enforces everything in these three sections and
runs in CI. Vale covers voice and terminology. If a rule fires, fix the page —
these are all migration artifacts, not judgement calls.

## Page anatomy

```mdx
---
title: "Short imperative title"
description: "One-sentence summary used for SEO and search results."
---

One-paragraph answer to "what is this and when do I need it".

## First task-oriented section
...
```

- `title` and `description` frontmatter are required.
- The H1 comes from `title` — never write an `# H1` in the body.
- End troubleshooting pages with a "Still having issues?" section pointing to
  [support@sessionboard.com](mailto:support@sessionboard.com) and what to include.

## Content boundaries

- Don't document internal-only admin/superuser tooling.
- Add-on features (Speaker CRM, Awards, SSO, Insights, Program Site, Custom
  Email Domain) get an `<AddOnNote>` near the top.
- Participant-facing pages live under `participants/` and never assume admin
  permissions.
