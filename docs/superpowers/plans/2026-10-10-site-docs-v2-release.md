# Site and Docs v2 — Plan 3: the Release — Implementation Plan

> Not started. Every step from 5 on is an external action and waits for the operator's explicit go.

**Goal:** Publish the new site and docs in place, with `v0.5.1`.

**Spec:** `docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` §6. **Before it:** plans 1 (frame) and 2 (content), both complete on `feat/site-docs-v2`; ledger at `docs/superpowers/specs/2026-10-10-site-docs-v2-ledger.md`.

## Global Constraints

- Nothing is pushed, merged, tagged or labelled without the operator's explicit go for that step.
- The deploy workflow runs on every push to `main`: the merge is the publication.
- Merge with a merge commit — never squashed or rebased. Each page's `verified` commit must stay in `main`'s history, or the build fails.
- Rollback is a revert of the merge commit.

## Task 1 — What the plan 2 reviews left (local, small)

> **Done 2026-10-10** (commits `f0cde93`, `702fa5b`, `cee221c`, `83c44bb`; reviewed, approved), except the instance-docs line: excluding the framework-only pages from a clone would leave dangling links in about ten docs an instance keeps, so it needs link rewriting in the clone engine. Still open and minor: the theme switch's edge loses its guaranteed contrast while hovered; the plan 1 "small things" the task's report lists as left.

- Theme switch: measure the knob's contrast against its track in both themes and its hit size (at least 24 by 24 CSS pixels); fix what fails.
- Copy button: on a touch screen it sits over the first line of a code block; give the block top padding there, or move the button above it.
- The trail above a doc's title is a `<p>`; make it a `<nav aria-label="Breadcrumb">` and keep the verifier's empty-doc check stripping it.
- Search link: it carries `role="button"` without answering the Space key; either handle Space or drop the role.
- `theme-color` meta: give it a value before script runs without writing a raw colour outside the theme files.
- Verifier: do not fail a build that happens to have no cross-page `#fragment` link; do not skip a raw-HTML link written inside `<code>`.
- Drift report: the directory exclusion hides `templates/scaffold/docs/`, which the file-structure page covers.
- Generated instances receive docs that describe framework-only things. Add one line at the top of an instance's docs saying so; this needs a small change in the clone engine and its tests.
- The items under "Small things" in plan 1's closing section that are still open.

## Task 2 — The operator looks at it (by eye)

`cd site && npm run build && npm run preview`, then `http://localhost:4321/org-os-template/`. Each section at desktop and phone width, both themes; keyboard through nav, sidebar, search, theme switch and prompt bar; one page with script off. The look and the interactive elements (one commit, `599b3db`, adjusted in `a195c76`) are a first pass made without the operator present: keep, dial down or drop.

## Task 3 — Decisions only the operator can make

Listed in the ledger under "Found in the code, not fixed". Before publication, at least:
- the workspace-snapshot command does not capture untracked files (the docs now say so; the script and the agent instructions that recommend it are unchanged);
- the knowledge system's publish, run directly on a canon, publishes draft-maturity entries;
- the live `map.json` and `dao.json` point at a host under an unregistered GitHub organisation and expose personal vault links;
- tracked agent persona files contain private vault paths;
- two module statuses changed on the evidence (`rad-org-os` → planned; territory pack → pilot);
- two integration pages (koi, egregore) are not on the site.

## Task 4 — Version surfaces (local)

`VERSION.md`, `CHANGELOG.md` and the other surfaces `npm run version:check` reads move together to `0.5.1` (`npm run version:update` — read `scripts/update-version.mjs` first). The changelog entry names what landed since `v0.5.0`. Rebuild; the site shows `v0.5.1`. Commit.

## Task 5 — Pull request (external: needs the go)

Push the branch; open the pull request with the ledger linked; CI green.

## Task 6 — Publish (external: needs the go)

Create the `docs-feedback` label in the repository. Merge with a merge commit. Push the tag `v0.5.1`.

## Task 7 — Check the live site

Every manifest page; search; `/get-started` and `/about`; both themes; a phone width; the feedback links open a prefilled issue; `llms.txt`. If anything is wrong: revert the merge commit.

## Task 8 — Afterwards, in `lf-work-os`

Close the "three stale docs" heartbeat item; note the new tag for the re-vendor item; record the session.
