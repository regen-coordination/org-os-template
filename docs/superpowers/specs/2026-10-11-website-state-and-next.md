---
id: website-state-and-next
title: "The org-os website: where it stands and what comes next"
status: proposal (awaiting operator decision)
type: state-report
created: 2026-10-11
author: website steward (crew seat `website`)
branch: crew/2026-10-11-website-take-stock-of-the-org-os-website-and-pro
based_on: feat/site-docs-v2 at 6defa27
---

# The org-os website: where it stands and what comes next

Written by the website steward on its first assignment. Nothing under `site/` was changed. Every
statement below is marked by how it is known: **checked** means a command run or a file read in
this session, on commit `6defa27`; **inferred** means reasoned from what was checked; **not
checked** means I could not or did not look.

## 1. In short

- The second version of the site is built and passes its own checks on `feat/site-docs-v2`: 46
  documentation pages in six sections, search, two themes, redirects for the old addresses. It is
  57 commits ahead of `origin/main`, never pushed (there is no `origin/feat/site-docs-v2`), and
  not published. (checked)
- Plans 1 (frame) and 2 (content) are done in the code. Plan 3 (release) has task 1 done with
  three things left; every other task waits on the operator: a look by eye, six decisions, and
  the go for the pull request, the merge and the tag. (checked)
- Three things the record does not say, found in this session:
  1. A fresh checkout does not build with the installs the role file and `site/README.md` name.
     It needs the root `npm ci` as well, and without it the build stops with a Node stack trace.
  2. The federation page shows all eight instances as "offline" and prints the maintainer's
     internal notes about each; the home page counts "8 instances", one of which the registry
     itself calls fictional.
  3. `feat/crew` and this branch both rewrite `docs/COMMANDS.md` and do not merge cleanly, and
     `feat/crew` adds a module to the catalog that the site's mirror does not have.

## 2. The state of each plan

### Plan 1 — the frame (`docs/superpowers/plans/2026-10-10-site-docs-v2-frame.md`)

The plan has eight tasks and 74 step checkboxes. **None is ticked** (`grep -c '^\s*- \[x\]'` → 0,
`- [ ]` → 74). The code says all eight tasks are done:

| Task | What it asked for | In the code (checked) |
|---|---|---|
| 1 Manifest and validation | `site/src/data/docs-manifest.mjs`, `site/src/lib/manifest.mjs` | present; `manifest: 46 pages OK` |
| 2 Repository facts, link resolver | `repo.mjs`, `doc-links.mjs` | present; `repo.test.mjs`, `doc-links.test.mjs` pass |
| 3 Load from the manifest, drop the allowlist | `remark-doc-links.mjs`, `remark-strip-title.mjs`; `docs-allowlist.ts` deleted | present; the allowlist file is absent |
| 4 Docs layout, feedback links | `DocsLayout`, `DocsSidebar`, `DocsToc`, `DocsFooter`, `feedback.mjs` | present |
| 5 Dark theme | `theme-boot.mjs`, `ThemeToggle.astro`, contrast test | present; `theme-contrast.test.mjs` passes |
| 6 Search | `search.mjs`, `Search.astro`, Pagefind in the build | present; `Indexed 47 pages` |
| 7 Home, docs index, modules, nav, redirects | `redirects.mjs`, `Redirect.astro`, 20 modules | present; both redirects verified by the build |
| 8 Build checks, CI history, README | `verify-build.mjs` reads the manifest; `fetch-depth: 0` in both workflows | present |

Its closing section, "Carried over from the plan 1 reviews", is still partly open. Checked in the
code today:

- still open: the sidebar's section headings are `h2` and come before the page's `h1`
  (`site/src/components/DocsSidebar.astro:14`); `Redirect.astro`'s canonical link
  (`site/src/components/Redirect.astro:15`); the comment in `scripts/render-templates.mjs:40`
  that says `DOC_SPINE` mirrors the manifest, which nothing enforces (outside `site/`).
- closed since: the breadcrumb is a `nav` landmark; `theme-color` has a value before script;
  the search link no longer carries `role="button"`; `OLD_DOC_SLUGS` is now written only in the
  verifier.
- not checked: the verifier and resolver hardening items, one by one.

### Plan 2 — the content (`docs/superpowers/plans/2026-10-10-site-docs-v2-content.md`)

Seventeen units and an integration task. The plan has no checkboxes; the ledger is its record.

| What the plan asked | In the code (checked) |
|---|---|
| Every page checked against the code, with a `verified` commit | 46 manifest entries, each with `verified`; the build fails without one |
| `ALLOW_UNVERIFIED = false` | `site/src/data/docs-manifest.mjs:27` |
| `/about` → `/docs/overview` | `redirect: /about → /docs/overview OK` |
| Fragment check in the verifier | `fragment check: 503 same-page and 1 cross-page links …` |
| Drift report, and a non-blocking CI step | `site/scripts/docs-drift.mjs`; `.github/workflows/validate.yml:88` |
| Ledger assembled | `docs/superpowers/specs/2026-10-10-site-docs-v2-ledger.md`: 49 files settled, 46 published |

Not published, by the ledger's decision: `docs/AGENT-MODES.md` (merged into the agentic
architecture page), `docs/integrations/koi.md` and `docs/integrations/egregore.md` (dropped). The
manifest agrees: the 14 markdown files under `docs/` that are not in it are those three plus the
eleven the design spec lists as repo-only. (checked)

**I did not re-verify the 46 pages' claims.** What I can say is narrower: `npm run drift` reports
that no path under any page's `covers` list changed between its `verified` commit and `HEAD`, so
the code the pages were checked against is the code on this branch.

### Plan 3 — the release (`docs/superpowers/plans/2026-10-10-site-docs-v2-release.md`)

| Task | State | Whose |
|---|---|---|
| 1 What the plan 2 reviews left | **Done** in `f0cde93`, `702fa5b`, `cee221c`, `83c44bb`, with three things left (below) | site, and `engineer` for one |
| 2 The operator looks at it by eye | not done | operator |
| 3 Decisions only the operator can make (six listed) | not done | operator |
| 4 Version surfaces to `0.5.1` | not done: `package.json`, `VERSION.md`, `CHANGELOG.md` and `MASTERPLAN.md` all say `0.5.0` (`npm run version:check` → "All version sources agree") | outside `site/` |
| 5 Pull request | not done; needs the go | operator |
| 6 Publish: label, merge commit, tag | not done; needs the go | operator |
| 7 Check the live site | not done | after 6 |
| 8 Afterwards, in `lf-work-os` | not done | outside this repository |

**What task 1 left.** The newest commit, `6defa27`, changes only the release plan: it adds the
"Done 2026-10-10" note. That note names three things:

1. **The instance-docs line.** A generated instance receives docs that describe framework-only
   things. Adding one line at the top of an instance's docs was not done, because leaving the
   framework-only pages out of a clone would leave dangling links in about ten docs an instance
   keeps. It needs link rewriting in the clone engine (`scripts/clone-framework.mjs`), which is
   `engineer`'s. (the plan's own note; I did not run a clone to see it)
2. **The theme switch's edge** loses its guaranteed contrast while hovered
   (`site/src/components/ThemeToggle.astro:51`). Minor.
3. **"The plan 1 small things the task's report lists as left."** The task's report is not in
   the repository: it lived in the working session's `.superpowers/` folder, which is absent from
   this worktree and not tracked. I listed above which small things are still open in the code;
   I cannot say which of them the report names.

### The last commits on the branch

`git log origin/main..HEAD` has 57 commits, all on 2026-10-10 between 01:33 and 03:55: the design
spec and plan 1 (01:33–02:22), a look pass (`599b3db`, 02:42), the seventeen content units
(02:50–03:13), review fixes (03:16–03:39), plan 3 written (03:48), task 1's four fixes (03:52)
and the note (03:55). Outside `site/` and `docs/` the branch touches six files: the two
workflows, `packages/org-os-kms/docs/CONNECTORS.md`, `scripts/render-templates.mjs` (a comment),
`tests/clone-genesis.test.mjs` and `tests/clone-manifest.txt`.

Note: the local `main` (`c2adaca`) is eight commits behind `origin/main` (`4e8b4ee`), so
`git log main..HEAD` shows 65 commits, eight of which are not this branch's work.

## 3. Where the record and the code disagree

| # | The record says | The code or a check says | Shown by |
|---|---|---|---|
| 1 | `roles/website.md`, "Install and check": run `npm ci --ignore-scripts` in `packages/org-os-federation-map/` and in `site/`, then build. `site/README.md:8`: `npm install # one-time`. | After exactly those installs `npm run build` exits 1 and `npm test` has one failure. The site's aggregator imports `packages/org-os-kms/src/map.mjs`, which needs `js-yaml` from the **root** install. Both workflows run the root `npm ci` first. | `cd site && npm run build` → `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'js-yaml' imported from …/packages/org-os-kms/src/map.mjs`; `npm test` → `pass 118, fail 1` (`test/map.test.mjs`) |
| 2 | Plan 1's steps are all unticked. | All eight tasks are in the code; plan 3 says "plans 1 (frame) and 2 (content), both complete". | `grep -c '^\s*- \[ \]' docs/superpowers/plans/2026-10-10-site-docs-v2-frame.md` → 74 |
| 3 | Plan 3 opens with "Not started." | Its task 1 says "Done 2026-10-10" and four commits carry it. | the plan, lines 3 and 18 |
| 4 | The design spec is `status: draft (awaiting operator review)`. | Two of its three plans are executed. The operator's review is task 2 of plan 3, so this is true but easy to misread as "nothing built". | the spec's frontmatter |
| 5 | The home page: "These docs describe org-os v0.5.0." The spec: one version of the docs, describing `v0.5.1`. | The pages were checked against this branch, which is 288 commits past the `v0.5.0` tag (`git rev-list --count v0.5.0..HEAD`). The sentence becomes true only when task 4 moves the version to `0.5.1`. | `site/dist/index.html`, section "Release" |
| 6 | Plan 3, task 1: the "small things" left are in "the task's report". | The report is not tracked. | `git ls-files .superpowers` → nothing |
| 7 | `DECISIONS.md`, `HEARTBEAT.md` and `docs/agent-plans/QUEUE.md` | None mentions the site and docs v2, its branch or its release. `MASTERPLAN.md` names those two files as where active work lives. A session starting from the framework's own record does not learn this work exists. | `grep -n -i 'site-docs\|docs v2' DECISIONS.md HEARTBEAT.md docs/agent-plans/QUEUE.md` → nothing |

The first is a defect by two of this seat's lenses. **Fail loudly, in words**: a newcomer who
follows the README gets a stack trace naming a file in another package, not a sentence saying
which install is missing. **Docs are tested**: the README's own run instructions are not checked
by anything. To finish this assignment I ran `npm ci --ignore-scripts` at the repository root as
well; it installs from the root lockfile and changes no tracked file (`git status` is clean).

Rows 2 to 4 and 6 are the site's own record and mine to correct; I left them, because the brief
rules out changes and another session may hold edits to the same files. Row 7 belongs to
`commons-steward`.

## 4. What the checks say

Run in `site/` on `6defa27`, after the three installs:

```
$ npm run build
manifest: 46 pages OK
required: 59/59 files present
federation.json: 8 nodes OK
link check: 5518 internal links on 53 pages carry /org-os-template once and resolve
fragment check: 503 same-page and 1 cross-page links with a #fragment point at an id that exists in the built page
redirect: /get-started → /docs/setup OK
redirect: /about → /docs/overview OK
llms check: 52 links OK, all 46 docs listed
doc bodies: 46 docs have content
search index: 47 pages indexed = 47 marked pages, all 46 docs among them

$ npm test
ℹ tests 119
ℹ pass 119
ℹ fail 0

$ npm run drift
docs drift: 45 page(s) with covers, compared with HEAD
No page has drifted: nothing under any page's covers changed since it was verified.
```

Could not run: anything in a browser. Search, the theme switch, the phone layout, the federation
map and the keyboard paths have been tested as functions and as built files, and nobody has yet
looked at them. Plan 1 says so; it is still true.

One page, `vault-safety-case-study`, has no `covers`, so the drift report can never flag it.

## 5. What a first-time visitor finds

Read from the built files in `site/dist/`, as text. (checked, except where marked)

**The home page** opens with "Run your organization on org-os" and "Documentation for operators
of org-os instances", three buttons (Operator guide, All docs, Modules), then the six sections
with their first four pages each, the version, and the federation panel. The newcomer paragraph
is at the bottom: "New to org-os? … Every instance today is run by the maintainer; an
unaffiliated pilot is the open milestone", linking to Overview. By the lens **the visitor's first
page**: an operator finds what to do next. A newcomer finds an honest statement of scope, last on
the page, which is what the spec chose.

**The docs**: 46 pages, each with a sidebar, on-page contents, previous and next, "Edit this
page", the stamp "Checked against `<commit>`", and two feedback links. The stamp links to a
commit that exists only on this unpushed branch, so until the merge those links would not
resolve. The feedback links open a GitHub issue with the label `docs-feedback`, which does not
exist yet (plan 3, task 6 creates it).

**Promised and missing, or wrong:**

1. **The federation page says every instance is offline.** All eight cards carry "offline". The
   aggregator marks an instance available only when its checkout sits beside this repository
   (`localPath: ../refi-bcn-os`), which is never true in CI. (checked here: `available: false`
   for all eight, `federation.json: 8 nodes, 8 edges (0 enriched)`; inferred for the deployed
   site, which builds in CI with no siblings.) A visitor reads "offline" as "these organizations
   are down".
2. **The federation page prints the maintainer's working notes.** Each card shows the `notes`
   field of `data/instances.yaml` whole. Among them: a named person's role in one organization;
   "the working tree carries ~2,275 uncommitted files"; "Bootstrap pending — identity/members/
   projects are TBD-stubs"; "Three pre-existing structural issues to resolve in next session".
   These are notes to self, not text for a public page. The spec left this page "unchanged apart
   from fresh data", so the content pass never read it. (inferred: the notes are on the live
   site today too; the branch changed one line of `federation.astro`.)
3. **"8 instances" on the home page counts things the registry says are not instances.** One is
   "fictional/test" and "not yet pushed to a remote", one is an agent runtime described as "not a
   data instance", one is "not an operational instance". The number is the row count of a file,
   and by **use-value first** a number on the front page should mean what a reader takes it to
   mean.
4. **`map.json` and `.well-known/dao.json`**, both linked from the page footer, carry addresses
   under a GitHub organisation that is not registered and links to personal repositories. The
   ledger already lists this for the operator (plan 3, task 3). (checked: `map.json` holds
   addresses under `github.com/organizational-os` and two personal accounts.)
5. **Two integrations have no page.** Koi and Egregore were dropped from the site as "nothing an
   operator can run or configure". The catalog still lists them. Already in plan 3, task 3.

**Out of date against the framework's documents on this branch:** nothing the drift report can
see. What it cannot see: the home page, the modules page, the federation page and `llms.txt`'s
framing are not manifest pages and carry no `verified` stamp. The modules page is held to
`docs/MODULES.md` by a test (20 modules, matching in both directions); the home and federation
pages are held to nothing.

## 6. What is coming from other branches

Nothing was merged or copied. Each branch was compared with this one from their common ancestor,
and a trial merge was computed in memory with `git merge-tree`, which writes nothing to the
working tree. "Covers" means the code paths a published page says it describes.

| Branch | Size | Published pages it edits | Pages whose covered code it changes | Merges with this branch |
|---|---|---|---|---|
| `feat/crew` | 86 commits, 111 files, last 2026-10-11 | `commands`, `modules` | 15 pages; most in `architecture` (12 files) and `commands` (9) | **conflict in `docs/COMMANDS.md`** |
| `feat/org-os-cockpit` | 37 commits, 139 files, last 2026-09-25 | `host-integration` | 12 pages; `packages/tui` and `packages/org-state` are new | conflict in `docs/HOST-INTEGRATION.md` and `DECISIONS.md` |
| `feat/kms-geo-ids` | 21 commits, 23 files, last 2026-09-30 | `kms-connectors` | `kms`, `kms-planes`, `kms-connectors`, `kms-publishing` and three broad pages | conflict in `CONNECTORS.md` and three kms source files |
| `feat/human-authored-born-rule` | 1 commit, 5 files | none | `kms` and three broad pages | clean |
| `feat/pi-harness` | 1 commit, a spec | none | none | clean |
| `feat/store-merge-policy` | no commits of its own | none | none | clean |

### What the site will need once `feat/crew` lands

From `git log --oneline origin/main..feat/crew -- docs roles` (51 commits) and
`git diff --stat main...feat/crew -- docs` (16 files, 4,619 insertions):

1. **A new page: `docs/CREW.md`** (301 lines), the operator's guide to the crew. It needs a
   manifest entry (section Operate, as I read it), a check of every command against
   `scripts/crew.mjs`, and a `verified` stamp. `roles/README.md` already links to it as the
   operator guide.
2. **`docs/COMMANDS.md` will conflict.** This branch rewrote the page from the code; `feat/crew`
   adds 30 lines of crew commands to the old text. Whoever merges second has to place the crew
   commands in the rewritten page and re-check them. (checked: `git merge-tree` names the file)
3. **The modules mirror will fail the site's tests.** `feat/crew` adds `org-os-crew` (status
   `pilot`) to `docs/MODULES.md` and does not touch `site/`. This branch's
   `modules-catalog.test.mjs` requires every catalog module to be in `site/src/data/modules.yaml`.
   Once both are on one branch, `npm test` in `site/` fails until the mirror gains the module.
   (inferred from the test's name, "every module in the MODULES.md catalog appears on the site",
   and the two diffs; not run, since running it means merging.)
4. **Fifteen pages will show as drifted.** Mostly because `package.json`, `scripts/`, `skills/`
   and the root records sit under broad `covers` lists. `commands`, `architecture`, `overview`,
   `skill-specification` and `file-structure` are the ones where the change is likely to be
   real: a new top-level `roles/` directory, a new `memory/crew/` folder, a new `crew` skill and
   a new npm script. Each needs a read and a new stamp.
5. **The role files themselves** (`roles/*.md`, `roles/circles.yaml`) are a new kind of framework
   file. Whether an instance receives them, and so whether File structure and Overview describe
   them as part of an instance, is a question for `commons-steward` and the crew spec, not for
   the site to decide. This seat's own role file says it is not shipped to a new instance.
6. **The changelog.** `feat/crew` adds a crew entry above `[Unreleased]`; plan 3's task 4 rewrites
   the same region for `0.5.1`. Not a site file, but it decides what the home page's "Changelog"
   link shows.

`feat/org-os-cockpit` and `feat/kms-geo-ids` will each need the same treatment for their pages
(Host integration; the four Knowledge pages), and both conflict in a doc this branch rewrote. In
each case the page on this branch was checked against code that the other branch then changes,
so the later merge must re-check, not just resolve the text.

**The general point.** Every page's stamp is a commit on this branch. The longer the branch stays
unmerged while others move, the more pages need re-checking at the merge, and the more rewritten
docs meet edits made to their old text. The merge order is the decision that sets how much of
that there is.

## 7. Proposal: the next three pieces of work

**The principal contradiction**, as this seat sees it: the site is finished enough to publish and
is waiting on things only the operator can do, while each day it waits the other branches make
its stamps older and its merge harder. The site's own next plan step is not the one whose
resolution unlocks the rest; the operator's look and the merge order are. So the three pieces
below are chosen to be useful whichever way those go, and to stay out of the release plan's path.

Steps I would **leave until the operator says who is doing them**, because the other session
working in the `feat/site-docs-v2` checkout may hold uncommitted work on them: everything in
plan 3 (the leftovers of task 1, the version surfaces of task 4, and tasks 2, 3 and 5 to 8), and
any edit to the plans, the spec or the ledger. That includes ticking plan 1's boxes and
correcting plan 3's "Not started".

### 1. A fresh checkout builds, or says in words why not

- **What.** `site/README.md` names the three installs in the order CI runs them. The aggregator
  checks for what it needs before importing and, when the root install is missing, stops with one
  sentence: what is missing and the command that fixes it. A test fails on the old behaviour.
- **Done means.** In a worktree with only the two installs the role file names, `npm run build`
  prints the sentence and the command and no stack trace; with all three, build and tests pass
  as today. A handoff to `commons-steward` asks for the same correction in
  `roles/website.md`, which lives on `feat/crew`.
- **Depends on.** Nothing. Touches `site/README.md`, `site/scripts/aggregate-federation.mjs` and
  one new test, none of which plan 3 names.
- **Operator's decision first?** No. One confirmation: that the other session is not editing
  those two files.
- **Lenses.** Fail loudly, in words; a guard for every bug.

### 2. The federation page and the instance count say only what is true and public

- **What.** Decide what the page may print from `data/instances.yaml`, then hold it there with a
  check. Three questions sit under it: which fields are public (the `notes` are not written for
  readers); what the page says about an instance whose checkout was not present at build time
  ("offline" is wrong; "not read at build" is true); and what the front-page number counts.
- **Done means.** The built federation page contains no text from a field outside an agreed
  list, and the verifier fails the build if it does. No card says "offline" for a reason that is
  only "built without the sibling checkout". The home page's count matches a stated definition of
  an instance, and a test holds it. If the answer needs a public-description field in
  `data/instances.yaml`, that change goes to `engineer` by handoff.
- **Depends on.** The operator's answers below. It joins plan 3 task 3's item on `map.json` and
  `dao.json`, and should be settled before publication, since the merge is the publication.
- **Operator's decision first?** **Yes.** Three: which instance fields are public; whether the
  test instance, the agent runtime and the development platform are counted; and whether this
  goes in before the `v0.5.1` merge or after.
- **Lenses.** Docs are tested; the visitor's first page.

### 3. Make the site ready for the crew to land

- **What.** On a branch that holds both `feat/crew` and the site: `docs/CREW.md` in the manifest,
  checked against `scripts/crew.mjs` and stamped; `org-os-crew` in the modules mirror; the crew
  commands placed in the rewritten Commands page and re-checked; each page the drift report
  flags read again and re-stamped or corrected.
- **Done means.** On that branch `npm run build` and `npm test` pass in `site/`, `npm run drift`
  reports no drifted page, the ledger gains a section for the pass saying what was checked and
  what could not be, and a `reviewer` handoff names the branch. Content changes to
  `docs/COMMANDS.md` and `docs/CREW.md` themselves go through `commons-steward`; the site follows
  the documents.
- **Depends on.** The merge order, and `feat/crew` being settled enough to check against. It is
  the same work whichever branch lands first, but it can only be done once, on the branch that
  holds both.
- **Operator's decision first?** **Yes.** One: which lands on `main` first, the crew or the site,
  and so where this work is done.
- **Lenses.** One source of truth; docs are tested.

After these, the same pass repeats for `feat/org-os-cockpit` (Host integration) and
`feat/kms-geo-ids` (the Knowledge pages) when each is ready to land.

## 8. What I could not find out

- Whether the other session holds uncommitted work in the `feat/site-docs-v2` checkout, and on
  what. I did not look outside my worktree.
- What the plan 3 task 1 report lists as left. It is not tracked.
- What the site looks like and how it behaves in a browser, in either theme, at any width.
- What the live site at `regen-coordination.github.io/org-os-template` serves today. I did not
  fetch it; statements about the deployed site above are marked inferred.
- Whether each of the 46 pages is still correct. I relied on the ledger and the drift report and
  re-checked none of their claims.
- Whether the merged modules test really fails (section 6, item 3). Inferred, not run.

## 9. Method, and what I would do differently

Read: the role and assignment files; `MASTERPLAN.md`, `SOUL.md`, `MEMORY.md`, `DECISIONS.md`
(the eight entries from 2026-08-21 to 2026-08-29 whole, and the matching lines for "site" in older entries, not those entries whole); the design spec whole;
the ledger's summary and its "Found in the code, not fixed" section; plan 2 and plan 3 whole;
plan 1's head, task list and closing sections, not its 2,700 lines of steps. None was absent.

What I would do differently: I ran the build before reading how CI installs, lost a run to the
missing root install, and only then read the workflows. Reading `.github/workflows/` first would
have found the gap by reading instead of by failing.
