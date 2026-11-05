# Held docs — written, not published

Pages and sections in this folder are **finished copy for product that is not in
production yet**. They are deliberately outside `src/content/docs/`, so the build
cannot pick them up and no customer can reach them.

A Help Center page describing a surface customers cannot see is worse than a thin
one, so the rule is: write it when you understand it, hold it until the deploy,
then move the section into the live article and delete it here.

| File | Waiting on | Check with |
| --- | --- | --- |
| `posters-not-yet-live.md` | Brand kit inheritance for the poster hall; the Opens/Closes window; the poster studio; real session filters on the Content tab | `node scripts/release-status.mjs --dry-run`, or compare each PR's merge commit against the latest successful `publish-prod-us-legacy.yml` run |

Nothing in here is linked from the sidebar, from `redirects-301.csv` or from a
release entry. Adding a release entry is part of *releasing* the held section,
not of writing it.
