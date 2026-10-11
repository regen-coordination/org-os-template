# Site and Docs v2 — Plan 3: the Release — Implementation Plan

> **In progress.** Task 1 is done, and tasks 1b to 1g were added and done on 2026-10-11. Tasks 2 and 3 are the operator's. Task 4 follows the operator's look. Every step from 5 on is an external action and waits for the operator's explicit go.
>
> **Whose it is.** Since 2026-10-11 the website steward (crew seat `website`) carries this plan, by the operator's decision. The operator keeps the look by eye, the decisions of task 3, the pull request, the merge and the tag. The order of release is: the site lands on `main` as `0.5.1`; the crew (`feat/crew`) follows toward `0.6.0`, and the site is made ready for it on that branch afterwards.

**Goal:** Publish the new site and docs in place, with `v0.5.1`.

**Spec:** `docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` §6. **Before it:** plans 1 (frame) and 2 (content), both complete on `feat/site-docs-v2`; ledger at `docs/superpowers/specs/2026-10-10-site-docs-v2-ledger.md`.

## Global Constraints

- Nothing is pushed, merged, tagged or labelled without the operator's explicit go for that step.
- The deploy workflow runs on every push to `main`: the merge is the publication.
- Merge with a merge commit — never squashed or rebased. Each page's `verified` commit must stay in `main`'s history, or the build fails.
- Rollback is a revert of the merge commit.

## Task 1 — What the plan 2 reviews left (local, small)

> **Done 2026-10-10** (commits `f0cde93`, `702fa5b`, `cee221c`, `83c44bb`; reviewed, approved), except the instance-docs line: excluding the framework-only pages from a clone would leave dangling links in about ten docs an instance keeps, so it needs link rewriting in the clone engine. Still open and minor: the theme switch's edge loses its guaranteed contrast while hovered (`ThemeToggle.astro:51`). The task's report, which listed the plan 1 "small things" it left, was kept in the working session's untracked folder and is not in the repository; the state of each small thing, read from the code on 2026-10-11, is now at the end of plan 1.

- Theme switch: measure the knob's contrast against its track in both themes and its hit size (at least 24 by 24 CSS pixels); fix what fails.
- Copy button: on a touch screen it sits over the first line of a code block; give the block top padding there, or move the button above it.
- The trail above a doc's title is a `<p>`; make it a `<nav aria-label="Breadcrumb">` and keep the verifier's empty-doc check stripping it.
- Search link: it carries `role="button"` without answering the Space key; either handle Space or drop the role.
- `theme-color` meta: give it a value before script runs without writing a raw colour outside the theme files.
- Verifier: do not fail a build that happens to have no cross-page `#fragment` link; do not skip a raw-HTML link written inside `<code>`.
- Drift report: the directory exclusion hides `templates/scaffold/docs/`, which the file-structure page covers.
- Generated instances receive docs that describe framework-only things. Add one line at the top of an instance's docs saying so; this needs a small change in the clone engine and its tests.
- The items under "Small things" in plan 1's closing section that are still open.

## Task 1b — Two fixes the operator approved (local)

> **Done 2026-10-11** by the website steward (commits `7a872e3`, `9bf41f2`), from the stock-take in `docs/superpowers/specs/2026-10-11-website-state-and-next.md`.

- A fresh checkout builds, or says in one sentence which of the three installs is missing and the command that fixes it; `site/README.md` names the three in the order CI runs them (`site/scripts/installs.mjs`, `site/test/installs.test.mjs`).
- The federation page prints each registered instance's name, type and link, and nothing else from `data/instances.yaml`; the registry's `notes` are in no built file; an instance whose checkout was not present at build has no status; the home page counts operational instances (maturity `production`) and prints that definition beside the number. The verifier fails the build on any of these.
- Left by it, for others: `docs/FEDERATION-MAP.md` describes the old aggregation and `docs/ECOSYSTEM.md` quotes one sentence of the registry's notes (both `commons-steward`'s); `roles/website.md` on `feat/crew` names two installs where three are needed (`commons-steward`'s).

## Task 1c — The tightened look (local)

> **Done 2026-10-11** by the website steward, on the operator's request for "a new polished/tight version". Spec: `docs/superpowers/specs/2026-10-11-site-tight-design.md`; held by `site/test/design-tight.test.mjs`. It replaces the look pass of `599b3db` and `a195c76`: the atmospheric layers, the pointer light and the iridescent edges are cut, so the "keep, dial down or drop" question of task 2 is now asked of this version. It also closes two open minors: the theme switch's edge keeps its contrast while hovered, and the sidebar's section names are no longer headings before the page's `h1`.

## Task 1d — What the Part A review left (local)

> **Done 2026-10-11** by the website steward, from the reviewer's findings 1 to 3 and `commons-steward`'s correction of two documents (`ff97a7b`).

- The leak check finds an excerpt of a note (any 40 letters in a row), reads through markup, case and escapes, and looks for drift flags and local paths; `site/README.md` says what it does not look for and why (`site/scripts/registry-leaks.mjs`, `site/test/registry-leaks.test.mjs`).
- The verifier's one exception (`QUOTED_BY_A_DOCUMENT`) is removed; `docs/FEDERATION-MAP.md` is re-stamped and `npm run drift` reports no drifted page.
- The definition beside the operational count says the maturity is set by hand and not measured.
- Left by it, for others: `docs/ECOSYSTEM.md` restates three registry notes in nearly their words (the ledger lists them); whether the registered list should name a test fixture and an agent runtime is the operator's, and needs a field in `data/instances.yaml` (`engineer`'s) if the answer is no.

## Task 1e — What the review of the tightened site left (local)

> **Done 2026-10-11** by the website steward, from the reviewer's findings 1 to 3 and 5 (PASS with findings on `461cbe2`) and `commons-steward`'s second pass on two documents (`b65fd8d`).

- Each command on the home panel is printed under the place it is run; the doctor is shown as it is run from the framework checkout. A test reads what an instance receives (`site/scripts/command-where.mjs`, `site/test/command-where.test.mjs`).
- `design-tight.test.mjs` reads the rules in their other spellings, each with a case that fails; one hover nudge it found is removed.
- A wide docs table scrolls in a focusable, named region, with a cue in words; the verifier fails on a table outside one (`site/src/lib/table-scroll.mjs`).
- `docs/ECOSYSTEM.md` and `docs/FEDERATION-MAP.md` re-stamped at `8587d21`; the excerpt length measured (32) and kept at 40, with the reason in the test file.
- Left by it, for others: the federation map's labels collide (`packages/org-os-federation-map`, handed to `engineer`).

## Task 1f — Unlisted entries (local)

> **Done 2026-10-11** by the website steward, on the operator's decision ("yes, drop the fixture and the runtime from the list"), from `engineer`'s field (`9cd5b2a`) and `commons-steward`'s paragraph (`b02ded3`).

- An entry of `data/instances.yaml` marked `listed: false` is not in `federation.json` or on the federation page, and is in neither count: the page lists six, the home page says 2 operational of 6 registered (`site/scripts/federation-aggregate.mjs`, `isListed` and `registryView`).
- The verifier takes its expected list and counts from `registryView`, checks `registered` (it did not before), reads the registered count back from both pages, and fails naming the entry when an unlisted one is printed.
- The sentences in `docs/DATA-MODEL.md` and `docs/FEDERATION-MAP.md` on what the site does with `listed` are corrected (the lead's call; nothing else in `docs/`). Five pages re-stamped at `7a80443`; `npm run drift` reports no drifted page.
- Left by it, for the operator: the map still draws "Bread Cooperative" and "openclaw" as ring-1 instances, on the home page and on `/federation`, because it is drawn from `federation.yaml`; and `docs/ECOSYSTEM.md`, a published page, names both. The ledger says what a visitor sees.

## Task 1g — What the closing review left (local)

> **Done 2026-10-11** by the website steward, from the closing review of `6eacb24` (PASS, "would publish as 0.5.1"; `memory/crew/2026-10-11-reviewer-closing-review-of-the-site-branch-every-2.md` in the main checkout).

- Finding 1: inline code in a doc may break inside a word (`DocsLayout.astro`). Measured in headless Chrome before and after, on all 51 built pages that are not redirects: six scrolled sideways at 375px and fourteen at 320px; none does now. `npm run widths` (`site/scripts/page-widths.mjs`) repeats the measurement and fails naming the page and the element; it needs Chrome, so it is not in `npm run build`. `site/test/page-width.test.mjs` holds the stylesheet rule at every `npm test`.
- Finding 2: a `listed` that is not `true` or `false` stops the build in a sentence that names the entry (`listedProblems` in `site/scripts/federation-aggregate.mjs`; `aggregate` throws it, the verifier repeats it).
- Finding 5: the leak check removes the characters a reader does not see (soft hyphen, zero-width space and its kin), reads the other hyphens as the plain one, and compares a sentence without its spaces; a case for each in `site/test/registry-leaks.test.mjs`.
- Finding 4: `site/test/design-tight.test.mjs` reads every radius (a token or a circle; the themes' tokens are 4px and 2px) and every animation in any spelling (only the mark's cursor is kept, by name), each with cases that fail.
- Finding 3, left as it is: the unlisted guard looks in `<li data-instance>` and `federation.json`, not for the two names anywhere on the site. `docs/ECOSYSTEM.md` names both on purpose and the map draws both, so a search for the names in every built file would fail today's build until the operator decides about those two. The ledger says so.
- Left by it, for others: `docs/DATA-MODEL.md` says any value of `listed` other than `false` "keeps the entry in"; the site's build now stops on one that is not a boolean (`commons-steward`'s sentence, handed off).
- Left by it, for the operator: the two open decisions under task 3 below (the map draws the two unlisted entries; `map.json` carries paths in the operator's workspace).

## Task 2 — The operator looks at it (by eye)

`cd site && npm run build && npm run preview`, then `http://localhost:4321/org-os-template/`. Each section at desktop and phone width, both themes; keyboard through nav, sidebar, search, theme switch and prompt bar; one page with script off. The look and the interactive elements (one commit, `599b3db`, adjusted in `a195c76`) are a first pass made without the operator present: keep, dial down or drop.

## Task 3 — Decisions only the operator can make

Listed in the ledger under "Found in the code, not fixed". Before publication, at least:
- the workspace-snapshot command does not capture untracked files (the docs now say so; the script and the agent instructions that recommend it are unchanged);
- the knowledge system's publish, run directly on a canon, publishes draft-maturity entries;
- the live `map.json` and `dao.json` point at a host under an unregistered GitHub organisation and expose personal vault links;
- tracked agent persona files contain private vault paths;
- two module statuses changed on the evidence (`rad-org-os` → planned; territory pack → pilot);
- two integration pages (koi, egregore) are not on the site;
- the map on the home page and on `/federation` draws "Bread Cooperative" and "openclaw" by name, above a list that says six: it is drawn from `federation.yaml`, which has no `listed` (closing review, 2026-10-11);
- `map.json` carries, for ring-2 nodes, `repo` values that are paths in the operator's own workspace (`03 Libraries/ReFi DAO`, `repos/egregore`), from the committed frontier cache (closing review, finding 6).

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
