# Personalization markers

One article, three surfaces. A Help Center page is read on the public site, on the public site by someone who happens to be signed in, and inside the product in the Team Lead **Learn** panel. Markers are how one MDX file serves all three without forking the content.

The split that makes this work:

- **MDX declares semantics.** "This block needs the Awards feature."
- **The surface decides behaviour.** The public site shows it. The product collapses it behind _"Awards isn't enabled for Acme Summit"_ with a link to turn it on.

Authors never write the behaviour. There is exactly one implementation of it — [`src/lib/marker-hydration.mjs`](src/lib/marker-hydration.mjs) — vendored into `sessionboard-web-ui-v2` so both surfaces render identically.

**Current spec version: 1.** Recorded in `tests/fixtures/marker-hydration.json` and asserted by both repos' test suites — the corpus runs here against the source and there against the vendored copy.

## The four invariants

These are load-bearing. Every one of them is a decision that cost something to get right.

**Content is never removed.** An unmet block is collapsed, not deleted. It stays in the DOM so it stays crawlable and citable, so support can screen-share the same article a customer is reading, and so a reader still discovers the feature exists. This is the entire reason personalizing a public page costs no SEO or AEO ground: there is one canonical URL and every crawler sees the full text.

**Unknown means visible.** If a condition cannot be evaluated — no event loaded yet, or the feature lives on a scope we have no data for — the block renders normally. Telling a customer they lack something they pay for is far worse than showing one extra paragraph.

**Hydration is idempotent.** React re-renders, the reader switches event, an island rehydrates. Re-running converges instead of nesting wrappers.

**Attributes are read, never evaluated.** The hydrator walks `data-sb-*` values. It never evaluates a string from the document, so a compromised article cannot become script execution.

## Authoring

Import from `@compat` as usual.

### Conditional on a feature

```mdx
import { IfFeature } from '@compat';

<IfFeature id="awards">
Scores roll up per program, so a judge only sees their own assignments.
</IfFeature>
```

Space-separate to require several: `<IfFeature id="awards crm">`. Use `as="span"` mid-sentence.

`id` is a **slug** from the product contract — never a module UUID. Scope is resolved from the contract, not written by you: `awards` happens to be org-level and `coordinators` event-level, and you should not have to know the difference.

### Conditional on an event setting

```mdx
<IfSetting id="enable_speaker_acceptance">
Each speaker still has to confirm from their portal before the session is settled.
</IfSetting>
```

`id` is a boolean column on the Event model — the things an admin toggles in settings.

### Add-on callout

```mdx
<AddOnNote feature="awards" />
```

Reads as _"Awards requires enablement, contact support"_ on the public site. In-product it knows better, so a customer who already owns Awards is not told to email support about Awards. For something sold but not feature-flagged, use free text: `<AddOnNote label="Custom Email Domain" />` — no personalization.

### Link into the product

```mdx
Open [Submissions](app:EventSubmissions) and check the confirmation column.
```

A link scheme rather than a component, because it works inline and inside tables where JSX is awkward.

No `href` is emitted. Every target needs an event or org id, and this repo cannot know either — a guessed `/event/123/sessions` is someone else's event. In-product the reader resolves the id against the event the reader is actually in; on the public site it stays labelled text, so nobody is handed a dead link.

Targets are curated, not every route: see `sessionboard-web-ui-v2/src/lib/appRoutes.json`. A target requiring an id docs cannot know (a `sessionId`, a `formId`) is not linkable, and a test in that repo enforces it.

### Article-level applicability

Frontmatter, not a marker:

```yaml
features: ["awards"]
audience: ["organizer"]
jtbd: "get speakers to confirm before the deadline"
```

`features` drives the "does this apply to you" banner in the reader **and** drops the article from Team Lead retrieval for events without the feature — so Team Lead never walks someone through a module they cannot open. `audience` keeps admin questions from returning speaker-portal steps. `jtbd` is the job in the reader's words; retrieval matches intent against it far better than against a title.

`features` is the one with teeth, so it is deliberately under-applied. A **missing** tag means the article shows to everyone, which is where the corpus started. A **wrong** tag tells a paying customer the product cannot do something it can. `npm run taxonomy:tag` only tags folders that map 1:1 to a gated product area for exactly this reason.

## Everything is validated at build time

A marker naming something that no longer exists fails **silently** at runtime: the block simply never satisfies, and a customer who does own Awards is told they do not. So nothing is allowed to reach production unverified.

| Command | Catches |
| --- | --- |
| `npm run markers:check` | Every bad id in the corpus at once, in under a second. Also rejects hand-written `data-sb-*` attributes, which bypass the components and so are never validated. |
| `npm run build` | The same ids, from inside the components, plus unknown `app:` targets. |
| `npm run index:check` | Every article still produces indexable chunks. |
| `npm test` | The hydrator itself, against the shared fixture corpus — including the never-remove-content and idempotence invariants. |
| `markerHydration.test.ts` (web-ui-v2) | The vendored hydrator matches this repo's, byte for byte, and renders the same corpus identically under jsdom. |

The ids themselves come from the product, not from here:

```bash
npm run contract:pull      # refresh src/data/product-contract.json from web-api + web-ui-v2
npm run markers:sync       # re-vendor the hydrator + fixtures into web-ui-v2
```

Run `contract:pull` when a marker you know is correct is rejected — a feature renamed in `sessionboard-web-api` shows up here as an unknown slug. Commit the result; the contract is checked in so the build needs no network and no sibling checkout.

## Adding to the spec

Changing the attribute vocabulary or the hydration behaviour means:

1. Edit `src/lib/marker-hydration.mjs` — the only implementation.
2. Add cases to `tests/fixtures/marker-hydration.json`.
3. Bump `MARKER_SPEC_VERSION` and the fixture's `specVersion` together.
4. `npm run markers:sync`, then commit **both** repos.

Skipping step 4 fails the consuming repo's checksum test rather than quietly shipping two behaviours.

The version tracks the **vocabulary and the behaviour**, not the module's exports. Widening the API without changing what any marker does — `unmetSummary` was exported so the in-product reader's article-level banner uses the same sentence as a collapsed block's summary — needs steps 1, 2 and 4 but not step 3. A bump obliges every surface to ship before it can personalize anything, so it is worth spending only on a real behaviour change.
