---
id: site-docs-v2
title: "org-os site and docs, second version — for operators (Design)"
status: built (plans 1 and 2 executed on feat/site-docs-v2; the operator's review by eye is plan 3, task 2)
type: feature-spec
created: 2026-10-10
last_updated: 2026-10-11
brainstorming_session: 2026-10-10
operator: luizfernandosg
location: org-os/site/ and org-os/docs/
workstream: public-surfaces
supersedes: 2026-06-17-org-os-website-design.md (in part — see §2)
---

# org-os site and docs, second version

> The site becomes a documentation site for people who already run org-os instances. Every page
> on it is checked against the code. It replaces the live site in place and ships with `v0.5.1`.

## 1. Purpose

**Audience:** operators of existing instances — the maintainer and collaborators on the federated
instances. Newcomers, clients and funders are not the audience of this version.

**Success:** an operator looking for how something works finds a correct, complete answer on the
site, reaches it from the sidebar or search, and can tell which commit the page was checked at.

**Why now:** the site was written for the v0.5 launch. `main` is more than 220 commits past
`v0.5.0`. Eleven of about 42 docs are on the site; nothing about the kms, the two planes,
extension packs or the territory pack is surfaced; links between docs are broken on the site; and
three pages are known to be wrong (`OPERATOR-GUIDE.md` level 1, `MODULES.md` on the admin app,
`site/src/data/modules.yaml` missing seven modules).

## 2. Decisions

| # | Decision |
|---|---|
| Foundation | The current `site/` Astro build, reworked. No move to Starlight. Adoption of the site system stays where its plan puts it (phase 4), outside this work. |
| Docs location | Files stay where they are. A manifest in the site decides what is published and how it is ordered. No file under `docs/` is moved or renamed. |
| Docs depth | Restructure and verify: each published page is checked against the code and corrected, rewritten, merged or dropped; missing topics are written new. |
| Design | Same identity (the "systems" theme, the `~/org-os` mark). Added: docs layout, search, dark theme, mobile navigation, feedback links. |
| Language | English only. |
| Versions | One version of the docs, describing `v0.5.1`. No version switcher. |
| Address | Unchanged: `https://regen-coordination.github.io/org-os-template/`. `base.config.mjs` stays the single place that would change for a domain. |
| Release | `v0.5.1`. `v0.6` stays reserved for the external-validation pilot (`DECISIONS.md`, 2026-08-21). |

From the 2026-06-17 spec this keeps the build-time federation aggregation, the theme-swap
architecture, the base-path gate and the machine layer. It replaces the curated allowlist, the
five-audience framing and the page set.

**Out of scope:** a custom domain; pt-BR docs; a version switcher; comment threads; the Abyss
theme and the home-page menu (site system track M5); converting the site's `--color-*` tokens to
the site system's contract; repairing the walkup setup path (the docs state its condition; they
do not fix it).

## 3. The docs structure

Six sections. The file in brackets is the source; **new** marks a page to be written. This list
is a ceiling: verification (§5) may merge or drop pages.

**Start**
- Overview — **new** (what org-os is, what an instance contains)
- Setup [`docs/SETUP.md`]
- Setup paths [`docs/SETUP-PATHS.md`]
- Adopt with an agent [`docs/ADOPT-WITH-AN-AGENT.md`]
- Tool setup [`docs/TOOL-SETUP.md`]

**Operate**
- Operator guide [`docs/OPERATOR-GUIDE.md`]
- Commands and the session lifecycle [`docs/COMMANDS.md`]
- Plans [`docs/PLANS.md`]
- Ideas [`docs/IDEA-HATCHING.md`]
- Workspace safety [`docs/VAULT-SAFETY.md`]
- Workspace safety: case study [`docs/VAULT-SAFETY-CASE-STUDY.md`]
- Reliability and recovery [`docs/RELIABILITY.md`]
- Versioning [`docs/VERSIONING.md`]
- Instance doctor — **new** (from `packages/instance-doctor`)
- Migrations [`docs/migrations/v2-to-v3.md`, `docs/migrations/v3-to-v3-5.md`]
- Host integration [`docs/HOST-INTEGRATION.md`]

**Knowledge**
- The kms: overview — **new**
- The two planes and the publication gate — **new**
- Connectors [`packages/org-os-kms/docs/CONNECTORS.md`]
- Extension packs — **new**
- The territory pack — **new**
- Publishing: standard.site and atproto — **new**
- The federation map — **new** (from `packages/org-os-federation-map`)

**Modules**
- Catalog [`docs/MODULES.md`]
- Admin app — **new** (from `packages/admin`)
- rad-org-os [`docs/RAD-ORG-OS.md`]
- Integrations, one page each [`docs/integrations/`: `berd`, `buzz`, `cloudflare-os`, `egregore`,
  `graphify`, `koi`, `opal`, `paper`]

**Reference**
- File structure [`docs/FILE-STRUCTURE.md`]
- Data model [`docs/DATA-MODEL.md`]
- Federation protocol [`docs/FEDERATION.md`]
- EIP-4824 [`docs/EIP4824-GUIDE.md`]
- Skill specification [`docs/SKILL-SPECIFICATION.md`]
- Skill promotion [`docs/SKILL-PROMOTION.md`]
- Packages [`docs/PACKAGES.md`]
- Package lifecycle [`docs/PACKAGE-LIFECYCLE.md`]

**Concepts**
- Architecture [`docs/ARCHITECTURE.md`]
- Agentic architecture [`docs/AGENTIC-ARCHITECTURE.md`]
- Agent modes [`docs/AGENT-MODES.md`]
- Patterns [`docs/PATTERNS.md`]
- Autoresearch [`docs/AUTORESEARCH.md`]
- Ecosystem [`docs/ECOSYSTEM.md`]

**Not published (repo-only):** `POSITIONING.md`, `QUEUE.md`, `QUILT.md`,
`V2-DEVELOPMENT-PLAN.md`, `KNOWLEDGE-INITIATION.md`, `knowledge-commons-astro-stack.md`,
`knowledge-commons-quickref.md`, `practical-knowledge-commons.md`, `CHAT-INTERFACE.md`,
`integrations/BROWSE-INTEGRATION.md`, `integrations/knowledge.md`, and the folders `research/`,
`sessions/`, `superpowers/`, `agent-plans/`.

New pages are created directly under `docs/`, in the upper-case naming the folder already uses
(`KMS.md`, `KMS-PLANES.md`, `INSTANCE-DOCTOR.md`, …). No new subfolder.

**Addresses.** The eleven current doc URLs keep their slugs. `/get-started` redirects to the
Setup page and `/about` to Overview. `/modules/rad-org-os` stays.

## 4. The frame

Static Astro, no client framework. Each unit has one job.

### 4.1 Manifest — `site/src/data/docs-manifest.mjs`

Replaces `docs-allowlist.ts`. Plain JavaScript, so `node --test` and `verify-build.mjs` can import
it without a TypeScript step. One entry per published page:

| Field | Meaning |
|---|---|
| `source` | Path of the markdown file from the repo root. May be outside `docs/`. |
| `slug` | The page's address under `/docs/`. |
| `title` | Shown in the sidebar and as the page's `h1`. |
| `section` | One of the six sections. |
| `order` | Position within the section. |
| `summary` | One line, for the docs index, search results and `llms.txt`. |
| `verified` | The commit the page was checked at (§5). |
| `covers` | Optional. Code paths the page describes, for the drift report (§5.4). |

The manifest is the only place that decides what is on the site. The sidebar, the docs index,
`llms.txt`, the redirects and the build checks all read it. Exposes `pageBySlug`, `pageBySource`,
`pagesBySection`, `neighbours(slug)`.

### 4.2 Loader — `site/src/content.config.ts`

Loads exactly the files the manifest names, from the repo root, instead of globbing
`docs/*.md`. Nothing is copied into `site/`.

### 4.3 Link rewriting — `site/src/lib/remark-doc-links.mjs`

Docs link to each other as files (`[…](ADOPT-WITH-AN-AGENT.md)`), which is right in the repo and
broken on the site. A remark plugin resolves each relative link from the page's source path:

- to a manifest page → its site address, with the base path and any `#fragment` kept;
- to another tracked file in the repo → its GitHub address at the commit being built (a tag would lag the deploy, which runs on every push to `main`);
- to nothing → the build fails, naming the page and the link.

Absolute and external links are left alone. The plugin is a pure function of (link, source path,
manifest, list of repo files), so it is unit-tested without Astro.

### 4.4 Docs layout — `site/src/components/DocsLayout.astro`

Wraps the existing `Layout`. Parts, each its own component:

- `DocsSidebar` — the six sections from the manifest; the current page marked with
  `aria-current`.
- `DocsToc` — on-page contents from the page's `h2` and `h3`. Omitted when a page has fewer than
  three headings.
- `DocsFooter` — previous and next (manifest order, across sections); "Edit this page" to the
  source file on GitHub; the stamp "Checked against `<short commit>`", linking to that commit;
  the feedback links (§4.7).

At phone width the sidebar is a `<details>` disclosure in a bar under the nav, which works
without script, and the on-page contents collapse above the article.

### 4.5 Search

Pagefind, run after `astro build` over `dist/`. Only the article body of docs pages and the
modules page is indexed. The search box sits in the nav and loads the index on first use. It
works under the base path and needs no service. Without script, the box is a link to the docs
index.

### 4.6 Dark theme

`themes/systems-dark.css` is completed into a full theme. To meet AA on every surface, the light
theme's accent is darkened slightly (`#1c7d3b`, then `#1a7738`, now `#176a32` after the look
pass) and its faint colour raised (`#969aa0`, now `#857a6b`, non-text use only). The aura, grain and glow tokens the look pass added to both
themes were removed on 2026-10-11 (`2026-10-11-site-tight-design.md`); the palettes are unchanged. Both themes are imported; the active one
is chosen by `data-theme` on `<html>`, set before first paint from the viewer's saved choice or
the system setting. A toggle in the nav saves the choice. A test checks text and accent contrast
in both themes against WCAG AA.

### 4.7 Feedback

No backend and no third-party script. Each docs page ends with:

- "Was this page useful?" — Yes · No
- "Report a problem with this page"

Each is a link to a new GitHub issue on `regen-coordination/org-os-template`, prefilled with the
page title, source path and verified commit, and labelled `docs-feedback`. One helper builds the
URL; it is unit-tested. The label is created in the repository as part of the release (§6).

### 4.8 Other pages

- **Home.** An operator's front door: the six sections as entry points with their summaries; the
  current version with a link to the changelog; the federation map as a small panel. The
  newcomer pitch is one paragraph linking to Overview.
- **Modules.** `modules.yaml` stays a mirror of `docs/MODULES.md`, with the seven missing modules
  restored. The drift test (`modules-catalog.test.mjs`) is tightened: the two lists must match in
  both directions, and each status must equal the catalog's.
- **Federation.** The map, and the registered instances by name, type and repository. Amended
  2026-10-11 on the operator's decision: nothing else from `data/instances.yaml` is published, an
  instance that was not read at build has no status, and the home page counts operational
  instances (maturity `production`) with that definition beside the number. The first draft of
  this line read "Unchanged apart from fresh data", which left the page printing the registry's
  notes. Amended again the same day, on the operator's decision ("drop the fixture and the
  runtime from the list"): an entry the registry marks `listed: false` is not on the list, and
  the registered and operational counts follow the list. The map is drawn from `federation.yaml`
  and is not changed by this; it still draws both.
- **Docs index.** The six sections with every page and its summary.
- **Removed:** `/get-started`, `/about` (redirects, §3).
- **Nav:** Docs · Modules · Federation · search · theme toggle.
- **`llms.txt`.** Regenerated from the manifest: every page with its summary.

### 4.9 Build checks

`verify-build.mjs` and `site/test/` are extended. The build fails when:

1. a manifest entry's `source` does not exist, or two entries share a slug or a source;
2. a manifest entry has no `verified`, or its commit is not in the repository;
3. a manifest page did not build;
4. any internal link on any built page points to a page that was not built (today only the docs
   index is checked);
5. an old address (§3) neither resolves nor redirects;
6. the base-path gate fails (unchanged);
7. either theme fails the contrast test.

The required-pages list in `verify-build.mjs` is derived from the manifest instead of being
written by hand.

## 5. The content pass

### 5.1 Verifying a page

1. Read the page and list its checkable claims: commands, file paths, flags, counts, statuses,
   and what a script is said to do.
2. Check each claim against the code on the branch by running the command or reading the file.
   Another doc is never evidence.
3. Settle the page's fate: **kept**, **corrected**, **rewritten**, **merged** (into which page)
   or **dropped**.
4. Record it in the ledger, `docs/superpowers/specs/2026-10-10-site-docs-v2-ledger.md`: page,
   fate, what changed, and anything that could not be verified.
5. Set `verified` in the manifest to the commit the page was checked at.

A claim that cannot be verified is removed, or kept and marked on the page as unverified. It is
never left standing unmarked. A page about something that is not built is dropped from the
manifest or cut to what exists.

### 5.2 Review

The agent that verifies a page does not review it. A second pass reads the diff against the code
and the ledger entry. Commands that change state (`clone`, `federate add`, `sync`) are run only
against a scratch directory, never against this repository or a sibling instance.

### 5.3 New pages

Written from the code, the tests and the package READMEs, in the voice of `SOUL.md`: plain,
direct, technically precise. Each opens with what the thing is, its status in the modules
vocabulary (live · pilot · in-dev), and the commands an operator runs. They go through §5.1 like
any other page.

The scope statements already in the repo stay wherever they apply: every instance is run by the
maintainer (single-operator dogfooding), and the walkup "fork and answer an interview" setup path
does not work for a newcomer (`POSITIONING.md`, "Bootstrap status").

### 5.4 Order

1. Operate and Start.
2. Reference.
3. Knowledge. The page list is settled after the kms code is read; "extension packs" and "the
   territory pack" may become one page.
4. Modules, then Concepts.

### 5.5 Staying true afterwards

`site/scripts/docs-drift.mjs` lists the manifest pages whose `covers` paths changed after their
`verified` commit. It runs in CI as a report and never fails the build.

## 6. Release

1. Work happens on `feat/site-docs-v2`, cut from `origin/main`, in a worktree.
2. `VERSION.md`, `CHANGELOG.md` and the other surfaces `npm run version:check` reads move
   together to `0.5.1`. The site reads the version from the repo; it is not written into pages.
3. The operator reviews a local build of the whole site. The pull request is opened with CI green
   and the ledger attached.
4. **Publication, on the operator's explicit go:** the `docs-feedback` label is created; the pull
   request is merged with a merge commit — never squashed or rebased, since each page's `verified` commit must stay in `main`'s history — the deploy workflow runs on every push to `main`, so the merge is the
   publication; then the tag `v0.5.1` is pushed.
5. The live site is checked: every manifest page, search, the redirects, both themes, a phone
   width, the feedback links.
6. Rollback: reverting the merge commit redeploys the previous site.

## 7. Testing

- **Unit (`node --test`, `site/test/`):** manifest integrity; link rewriting (each of the three
  outcomes, fragments, links from files outside `docs/`); the feedback URL; the drift report; the
  existing federation and modules tests.
- **Build:** the checks of §4.9.
- **By eye, before the go:** every section at desktop and phone width in both themes; keyboard
  through the nav, sidebar, search and theme toggle; the page with script disabled.

## 8. Plans

Three implementation plans, in order:

1. **Frame** — §4, with the eleven current pages plus Setup (the target of `/get-started`) carried
   into the manifest unverified behind a temporary flag, so the site builds throughout. `/about`
   redirects to the docs index until Overview exists. Dead links in those pages are unlinked so
   the build passes. The flag is removed in plan 2; check 2 of §4.9
   is enforced from then on.
2. **Content** — §5, section by section, in the order of §5.4.
3. **Release** — §6.
