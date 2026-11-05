# Posters — written, held until it ships

Four poster changes are written here and **not** in the live articles, because on
2026-11-05 none of them was serving customers. Each section says where it goes
and what has to be true before it moves.

Status was taken by comparing each PR's merge commit against the latest
successful production deploy, not against `main`:

| Change | web-api | web-ui-v2 | In production on 2026-11-05 |
| --- | --- | --- | --- |
| Brand kit inheritance | #5161, merged | #1482, merged **and deployed** | **No** — the UI shipped in `release/2026-11-05`, the API did not; prod-us/eu were still on `release/2026-11-04` |
| Opens/Closes window | #5170, merged | #1486, open | No |
| Poster studio | #5170, merged | #1486, open | No |
| Real session filters | #5162, open | #1487, open | No |

The brand kit row is the one to watch: its **UI is already in front of customers**
with no server behind it. The next web-api release makes the section below true;
until then, saying the hall follows the brand kit would be wrong for every
customer who tried it.

---

## 1. The hall's branding comes from your Brand kit

*Goes in `marketing/poster-gallery.mdx`, inside the "Name it and brand it" step,
above the Gallery name / Public title paragraphs. Screenshot already captured:
`/images/kb/poster-gallery-brand-kit.png`.*

> The top of **Appearance** names the [Brand kit](/marketing/brand-kits) the hall
> follows and says how it was chosen — the kit assigned to this event, or your
> organization's default. Colour, logo, heading font and page background come
> from it, so a change to the kit restyles every hall that has not overridden
> that value.
>
> ![The Brand card at the top of the Appearance tab, naming the kit the hall inherits from and explaining that anything set below overrides it for this gallery only](/images/kb/poster-gallery-brand-kit.png)
>
> Everything below is an override: set it and this gallery uses it; clear it and
> the value goes back to the kit. A field following the kit is marked **From**
> *kit name*, and an overridden one offers **Use the brand kit** to hand it back.
>
> **Page background** is the one field with no equivalent anywhere else:
> **Inherit** takes the kit's background image, or a wash of its primary colour;
> **Plain**, **Accent wash** and **Image** set it for this gallery.
>
> <Note>
> Galleries created before this change copied the event logo onto the gallery
> when they were made, so their **Logo** shows as overridden. **Use the brand
> kit** switches it to the kit's logo.
> </Note>

**Release when:** a web-api release containing #5161 is live in prod-us and
prod-eu. Then also drop the "Accent color and Heading font" wording in the live
step, which currently avoids saying where those values come from.

---

## 2. Opens and closes, not "embargo"

*Replaces the first bullet of "Hold posters back until you are ready" in
`marketing/poster-gallery.mdx`, and the embargo sentence in the `<Note>` at the
end of `participants/upload-a-poster.mdx`. Needs a fresh screenshot of the
Access card — `/images/kb/poster-gallery-access-modes.png` shows the old
**Embargo until** field and must be recaptured.*

> A hall has an **Opens at** and a **Closes at**, and both are optional — a hall
> with neither is simply always open, which is what most are.
>
> - **Opens at** holds the hall back until a date and time in the event's
>   timezone. This is what used to be called an embargo, and an existing embargo
>   date became the open time.
> - **Closes at** is its other half: a hall that runs for a season and then
>   stops.
> - **While the hall is shut** decides what a visitor sees outside the window:
>   **Teaser** shows titles with a countdown, **Hide** shows nothing.
>
> The gallery list and the event app's inherited-settings summary show the same
> state, so you can tell at a glance which halls are open.

Also update, in the same pass:

- `attend/posters.mdx` — the **Embargo** row of "What the app inherits from the
  gallery" becomes the open/close window.
- `marketing/poster-gallery-visitors.mdx` — nothing to change; it never names the
  embargo field.

**Release when:** web-ui-v2 #1486 is merged **and** a web-ui-v2 production
deploy contains it. The API half (#5170) is already on `main`; the UI is what a
customer sees.

---

## 3. The poster studio

*Replaces "Build a poster in the browser" in `participants/upload-a-poster.mdx`.
The current section documents the builder that is live today; the studio replaces
it wholesale, so this is a swap, not an addition. Needs new screenshots —
`/images/kb/portal-poster-builder.png` is the old builder.*

> **Build your poster** opens the poster studio: the same block editor, with
> three things the builder did not have.
>
> - **Versions.** Every publish is a version, listed with its date, so you can
>   see what the hall showed last week.
> - **Narration** sits in the studio beside the poster rather than on a separate
>   card, so recording and editing happen in one place.
> - **Comments** from the organizer are in the tool rail, next to the block they
>   are about, instead of under the file.
>
> **Upload a new version** is in the tool rail too, so an author who built a
> poster and then had one designed does not have to go back to the Files tab.

**Release when:** web-ui-v2 #1486 is merged and deployed. Recapture
`portal-poster-builder.png`, `portal-poster-narration-card.png` and
`portal-poster-comments.png` against the studio before publishing.

---

## 4. Real session filters on the Content tab

*Replaces the "Pick the sessions that feed it" step in
`marketing/poster-gallery.mdx`. Screenshots
`/images/kb/poster-gallery-session-formats.png` and
`/images/kb/poster-gallery-tracks.png` show today's checkbox lists and must be
recaptured.*

> **Session formats** and **Tracks** become full session filters: any session
> field, with the same operators as the sessions grid, so a gallery can collect
> "Status is Accepted and Track is Oncology" rather than only formats and tracks.
> **Scope** decides whether the gallery takes parent sessions, their
> sub-sessions, or both — which is what a poster hall built as one parent session
> with a board per sub-session needs.

**Release when:** web-api #5162 and web-ui-v2 #1487 are both merged and in a
production deploy.

---

## When you release one of these

1. Move the section into the article it names, with its screenshots recaptured
   against the deployed UI (not against a branch).
2. Add a release entry in `src/data/release-notes/<date>.json` naming the PRs in
   `shipped.prs` — that is what tells CS it is real.
3. Delete the section here, and the row in `held/README.md` when the file empties.
4. `npm run check:style && npm run breadcrumbs && npm run og && npm run build && npx wrangler deploy`, then purge the edge cache.
