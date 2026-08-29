# Changelog

All notable changes to **org-os** (the framework) are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org) within a given line — but note the **2026-06-17 `0.x` pre-beta re-baseline** (see `[0.5.0]`), a one-time deliberate, non-SemVer renumbering of `3.5 → 0.5`.

For the policy that governs what counts as a version bump, see [`docs/VERSIONING.md`](docs/VERSIONING.md).

## [Unreleased]

**Staged for `0.5.1`.** Everything below is already on `main` but landed *after* the `v0.5.0`
tag, so a clone of the tag does not have it. `npm run version:update 0.5.1` promotes this
section to a dated release heading and rewrites the comparison links — the heading stays
`[Unreleased]` until then because `version:check` reads the first `[X.Y.Z]` heading as the
current release and would fail against `package.json`.

Still open for 0.5.1, not yet done: the **file-level overlay sync** that replaces the
history-based one (see `[0.5.0]` → Known issues), the two 🔴 **kms data-loss** fixes, and the
remaining admin defects (YAML reflow rewriting whole registries on a one-field edit; the
per-registry write lock racing `.git/index.lock` across registries).

### Added

- **`docs/ADOPT-WITH-AN-AGENT.md`** — the copy-paste recipe for driving setup from Claude Code,
  Cursor or a ChatGPT connector. Non-interactive end to end, so an agent can complete it without
  a TTY. Verified by executing it against a fresh clone of `main`.
- **Session kit** (`docs/sessions/`) — narrative, live demo script, FAQ, a one-pager rendered
  through `render:templates` so its numbers stay live, plus the branch-instance and scheduling
  drafts for the Regen Knowledge Commons session.
- **`tests/clone-framework-health.test.mjs`** gains a no-leak test, and **`packages/admin/tests/real-data.test.ts`**
  is new: it runs the admin app's own validator over this repository's real registries, which is
  the regression that would have caught every admin defect fixed below.

### Fixed

- **The recommended setup path shipped the framework's own content.** A fresh instance carried
  the maintainer's member entry, 13 framework projects, framework ideas/ecosystems/relationships,
  the framework's `SOUL.md` and API endpoints, and its federation frontier cache — the 2026-08-21
  clean-room B4/B5 leak, still alive in the engine path. `clone-framework` stage 4b now resets
  instance-owned registries and operator files, so identity is stripped **by construction**
  rather than by operator diligence. Clean-room re-run against public `main`: zero leaks.
- **The admin app could not open or save this repository's own data.** Schemas were derived from
  `DATA-MODEL.md`'s examples rather than real registries: `projects` 0/13 valid (status enum vs
  the real `Discovery`/`Develop`), `relationships` 0/7 (touchpoints typed as objects; real data is
  strings, plus `null` rejected on optional fields). `projects.status`/`type` are no longer enums —
  fleet evidence shows the vocabulary is instance-defined and genuinely differs — and optional
  fields across all 14 schemas accept `null`, which is how an unset field is written in these YAML
  registries.
- **A funding-opportunities data-loss path.** The admin hardcoded the top-level key
  `funding_opportunities`; four of five real instances use `opportunities`. The UI showed an empty
  registry for a populated file, then appended to a *new* second top-level key on create, splitting
  one list in two. `RegistryDef` now carries aliases and every call site resolves against the
  document.
- **The admin entity form showed one entity's data under another's heading.** `EntityForm` seeds
  its draft once and had no `key`, so selecting a different row reused the instance; saving then
  422'd on an id mismatch, or 409'd as a duplicate after `+ New`.
- **CI could not run the instance-doctor suite.** Fixture repos had no git identity and runners
  have no global one, so the doctor's own commit stages died with `fatal: empty ident name` —
  `validate.yml` was red while local runs passed on the developer's global config.
- **`version:update` left two of the five version surfaces stale.** It bumped package.json,
  federation.yaml and the CHANGELOG but not `VERSION.md` or `MASTERPLAN.md`, and because
  `version:check` compares major.minor the gap passed silently — cutting a patch release would
  have shipped a `VERSION.md` reading the previous version. Bump mode now moves every surface it
  checks.
- **`AGENTS.md` §11 pointed at the wrong upstream.** Now the canonical `org-os-template`. Executing
  the fix corrected the record: `org-os-framework` and `organizational-os-framework` are the *same*
  repository (the latter is a former name GitHub redirects), so the "three circulating names" were
  two repos. The legacy one is archived with a README pointing here.

### Changed

- **One honest setup path** across the quickstart trio. `BOOTSTRAP.md`, the README and
  `docs/OPERATOR-GUIDE.md` now tell one story: the cloning engine as a generator, with
  `npm run setup` framed as the in-place TTY-only alternative and its real nine prompts listed.
  Closes clean-room findings **B1**, **M2**, **M4** and **m2**; `OPERATOR-GUIDE` Level 2 stops
  promising a web form that does not exist.
- Site `/get-started` rewritten to that path; the agent recipe joins the curated docs allowlist;
  `POSITIONING.md` numbers re-verified against the tagged release.

## [0.5.0] — 2026-08-29

**The beta.** The release that makes org-os stable and reliable enough for real adoption and
collaborative use: a consolidated trunk, a public site, a package that can assess any
downstream instance, one coherent versioning story, and a branch topology that is just `main`.

**Version-scheme re-baseline (deliberate, non-SemVer).** Declared **2026-06-17**, shipped here.
org-os adopts a `0.x` **pre-beta** scheme to signal pre-1.0 maturity honestly. The line previously
numbered `1.x → 2.x → 3.x → 3.5` (four milestones) is designated **v0.5** — the fifth. `0.5 < 3.5`
is intentional and reflects "pre-beta", not a regression; SemVer ordering does not apply across
this re-baseline. **This paragraph is the single source of truth for the cross-scheme map**;
`docs/VERSIONING.md` restates it and `packages/instance-doctor` implements it. Historical tags are
published as `archive/v3.0.0` / `archive/v3.5.0`, never bare, so they cannot outrank `v0.5.0` in a
semver-sorted list.

### Added

- **`packages/instance-doctor`** — the reliability centrepiece. `doctor assess` runs six checks
  over any instance (identity coherence + template leakage, lineage stamps, cross-scheme version
  surfaces, machinery integrity, structure/schemas, freshness) and prints a BLOCKER/WARN/OK
  scorecard with `--json` and blocker exit codes — **proven against all six real instances plus
  the framework itself in the 2026-08-28 acceptance run**, where it surfaced every defect that
  run reported. `doctor sync` runs nine stages — snapshot, ensure-upstream, fetch,
  inject-machinery, sync-upstream, migrate, generate-schemas, re-assess, receipt — aborting on
  the first failure so an instance is never left half-migrated. **Its `--dry-run` planning half
  is proven; a full sync is not** — the same acceptance run found the strategy it delegates to
  cannot apply to scaffolded instances (see Known issues), so v0.5's proven surface is
  `assess` + `sync --dry-run`. Hub mode (`npm run doctor -- --dir ../other-instance`) is what
  breaks the bootstrap deadlock: an instance cannot repair its own updating mechanism using its
  own updating mechanism, so the framework supplies it. Ships `skills/instance-doctor/SKILL.md`,
  `npm run doctor`, and `modules/org-os-instance-doctor/module.yaml` — the **second tracked
  module**, which fires the module-engine un-freeze trigger for v0.6.
- **Admin app M1** — `packages/admin/` lands on trunk after eight months on a branch, with its 44
  tests wired into `npm test`, `selftest` and CI so they cannot go quiet again.
- **Public site, live** — `https://regen-coordination.github.io/org-os-template/`, auto-deploying
  on push to `main`, with a base-path gate asserting every internal link carries `/org-os-template`
  exactly once.
- **symbient v2** — practice promoted to framework capability: `skills/symbient/` (contract +
  vendored Quilt Protocol by Wib & Wob, CC BY-NC), `scripts/symbient-hatch.mjs` +
  `scripts/lib/symbient-gates.mjs` (the canonical GATES.md parse — no production code calls it
  yet; all stage-gating is agent-honored, and any host reading GATES.md programmatically must use
  this module), conditional close-pulse in `/close`, hermes on-demand surfacing. Habitats are
  operator-private (gitignored).
- **Federation map** — `@org-os/federation-map`, an interactive map of an instance's external
  world (ring 1 instances · ring 2 frontier peers-of-peers · ring 3 sources/ecosystems), plus the
  kms data plane behind it (`render map`, `federate frontier`, offline vault artifact).
- **kms + quilt** — `@org-os/kms` binds `@regen-commons/toolkit-framework` into org-os as both a
  module and the default knowledge profile.
- **Cloudflare OS integration M0–M2** — the `gatekeeper-org-os` adapter, a pure page core shared
  with `page-shim`, GitHub/memory substrates, and the org-dashboard gadget. First tracked module.
- **graphify integration** — knowledge-graph ingest via `graphify export --wiki` +
  `compile:knowledge`, with `graph:status` / `graph:gaps` surfaced in the dashboard.
- **Autopoiesis Phase 2** — cascade closure: the 10-stage `scripts/sync-upstream.mjs`,
  `scripts/validate-identity.mjs`, and the `genesis_commit` / `last_sync_commit` lineage stamp.

### Changed

- **One versioning story.** `version:check` now reads **five** surfaces, not three — `package.json`,
  `federation.yaml`, `CHANGELOG.md`, root `VERSION.md`, and the `MASTERPLAN.md` header. The two it
  could not previously see were the two that were wrong: `VERSION.md` said `1.0.0` and
  `MASTERPLAN.md` said `2.0.0` while the framework was on `0.5.0`. Both corrected.
  `docs/VERSIONING.md` rewritten around the `0.x` line: `0.minor` is a milestone counter, `1.0.0`
  is reserved as a claim rather than a number, and `3.x` is demoted to Historical.
- **`clone-framework.mjs` no longer produces a broken instance.** It emitted one with 7 doctor
  blockers seconds after creation. It now renders the instance's own `.well-known/dao.json`,
  strips the framework's generated `.well-known/*.json` and CHANGELOG, reads the framework version
  instead of hardcoding `3.5`, writes the canonical upstream URL rather than a legacy spelling,
  and drops npm scripts pointing at files the instance never receives.
  `tests/clone-framework-health.test.mjs` fails the build if any of it regresses.
- **CI enforces the release gate.** `validate.yml` runs `npm test` and the site build/tests, with
  the stale soft-fail on `validate:schemas` removed.
- **Branch topology cleared to `main`.** Nine branches and five worktrees retired behind 18
  `archive/*` tags, each annotated with its restore command; proof in
  `memory/reports/branch-triage-2026-08-28.md`.
- **The vault-safety guard** stopped over-matching: `clean` / `stash` / `reset --hard` are matched
  only in git subcommand position, so pathspecs and commit messages naming them no longer trip it.
- **Status debt cleared** — `MASTERPLAN.md`'s Activations section (a v2-era checklist long after
  every item shipped) now points at the live queue; `docs/SETUP-PATHS.md` reduced to an honest
  stub; the README states one recommended bootstrap path and how to verify it.

### Removed

- `MASTERPROMPT.md` — superseded by `MASTERPLAN.md` + `AGENTS.md`.
- `npm run quartz` and `npm run setup:cursor` — both pointed at files that have never existed in
  this repository's history, and `setup:cursor` was documented in two places as if it worked.

### Known issues

Shipped knowingly and documented rather than quietly.

Two **data-loss** defects in the kms layer, found by production use in `refi-dao-os` and
recorded in its framework-feedback ledger:

- 🔴 **`kms store` silently overwrites objects sharing a title-slug** (ledger B5) — at scale this
  loses knowledge objects without an error.
- 🔴 **kms provenance criticals** (ledger section D, two items).

**Disposition (WS-F4):** the fix targets **v0.5.1**, and these items **gate v0.6 Active-1**
(downstream propagation) — the fleet is not synced onto a knowledge store that can lose data.
Data loss is exempt from the portfolio freeze table. Both instance feedback ledgers are now
registered as recognized upstream inputs in `docs/SKILL-PROMOTION.md`.

One architectural finding from the release's own acceptance run (WS-H, 2026-08-28 —
`memory/reports/ws-h-acceptance-2026-08-28.md`):

- 🔴 **A full `doctor sync` cannot yet sync any real instance.** Stage 5 delegates to
  `scripts/sync-upstream.mjs`, whose `git pull --rebase upstream main` assumes the instance is a
  *fork* of the framework — but every real instance is a *scaffold* with its own root commit
  (verified six-for-six), so the rebase conflicts and leaves the repo mid-rebase. The lineage
  stamps record the true provenance; git history does not. The v0.5 reliability claim is
  therefore **`assess` + `sync --dry-run`**, both proven against the live fleet.

**Disposition (operator decision 2026-08-29, per the WS-H report's option 2):** replace the
history-based sync with a **file-level overlay** (framework-owned paths copied, instance-owned
paths untouched, lineage stamp recording the applied framework commit — the primitive
`sync-packages.mjs` already uses) in **v0.5.1**, then re-run WS-H acceptance in full. Fleet
propagation stays v0.6 Active-1, already gated on the kms items above.

Also known, and *not* fixed here: `npm run setup` (the in-place wizard) remains TTY-only and has
not been re-tested end to end since the 2026-08-21 clean-room run. Use `clone:framework`.

### Follow-ups (flagged, not done here)

- Downstream instances still record legacy `framework_version` values (`3.0`/`3.5`). Propagation
  across the fleet is v0.6 Active-1, gated on the kms items above; `doctor sync` is the vehicle.
- Six different repository names have circulated as "the framework" and every instance declares a
  wrong one. All six are recorded in `packages/instance-doctor`'s `KNOWN_WRONG_UPSTREAMS`;
  reconciling the repositories themselves is a separate operator action.

## [3.5.0] — 2026-05-16

The "Consolidation + Ready for Real Orgs" release. Formalizes ~12 months of accreted skills, packages, scripts, and structural innovations across the framework and downstream instances into a single coherent release. Plus the missing machinery (reliability layer, package lifecycle, cloning engine, cascade closure) that makes the framework genuinely self-serve.

### Consolidation backbone (Tier 1)
- 9 superpowers-* skills (brainstorming, executing-plans, finishing-a-development-branch, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, writing-plans).
- 3 expertise skills: expert-feynman, karpathy-guidelines, initialize.
- 2 host-integration packages: hermes-integration (Hermes runtime tool + skill bundle), opencode-integration (npm plugin + 5 slash commands: /dashboard, /initialize, /org-projects, /org-decisions, /org-this-week).
- 5 promoted P0 skills from instances (≥2 adoption): frontend-design, artifacts-builder, skill-creator, mcp-builder (Anthropic-vendored, generalized); meeting-notes-transcription-fixer (framework-authored).
- 5 promoted P0 scripts (≥3 instance adoption, mostly byte-identical): compile-knowledge, index-linked-repos, lint-knowledge, normalize-kb-frontmatter (refactored to load aliases from data/knowledge-aliases.yaml), update-knowledge-index.
- Hub vault-safety pattern promoted to framework: scripts/vault-snapshot.mjs, scripts/vault-audit.mjs, docs/VAULT-SAFETY.md (193 lines: iron rules + safe pattern + 7-layer recovery runbook + 2026-04-25 incident case study).
- scripts/check-divergence.mjs — advisory md5 comparison across instances vs framework canonical.
- scripts/page-shim.mjs — transitional bridge for `npm run page <id>` (renders 7 pages until TUI ships in v3.6+).
- Matrix integrity pass: data/skills-matrix.yaml rewritten with honest promotion_status; data/packages-matrix.yaml extended with `lifecycle_status` field (active/dormant/planned/retired). docs/SKILL-PROMOTION.md extended with Script-Level Reconciliation section + Known Divergences table.

### Operator-facing surface (Tier 2)
- System reliability layer: docs/RELIABILITY.md, scripts/selftest.mjs aggregator, scripts/install-hooks.mjs + .github/hooks/pre-commit.sh, .github/workflows/{validate,drift}.yml.
- Version triplet check: `npm run version:check` verifies package.json, federation.yaml, and CHANGELOG.md all agree.
- Skills section: scripts/lib/discover-skills.mjs walker, scripts/generate-skills.mjs → SKILLS.md + .well-known/skills.json, /skills slash command.

### Real-org-ready machinery (Tier 3)
- Package integration: docs/PACKAGE-LIFECYCLE.md, scripts/sync-packages.mjs (TDD, 5 tests).
- One-pager templates: templates/render.mjs (~95-LOC mustache renderer, 9 tests), templates/README.{framework,instance}.md, templates/GETTING-STARTED.md, templates/partials/{cheatsheet,federation}.md, scripts/render-templates.mjs.
- Cloning engine: scripts/clone-framework.mjs (8-stage non-interactive bootstrap, 4 tests).
- Acceptance test: bread-coop-os bootstrapped end-to-end (registered in data/instances.yaml as framework_version: "3.5").

### Cascade machinery (Tier 4)
- Autopoiesis Phase 2 (Loop C cascade closure): scripts/sync-upstream.mjs (10-stage pull-based sync with vault-safety + .sync-freeze guard + receipt logging), scripts/validate-identity.mjs (IDENTITY.md ↔ federation.yaml agreement + lineage stamp shape).
- Lineage stamp in federation.yaml.metadata: `genesis_commit` (immutable, 40-hex SHA from framework's root commit) + `last_sync_commit` (mutable).

### Changed
- Validator: fixed long-standing bogus "federation section" check; added section 9 enforcing lifecycle_status + promotion_status enum values; pre-release version exemption.
- IDENTITY.md type narrowed to controlled vocabulary "Project"; validate-identity now enforces agreement with federation.yaml.identity.type.
- BOOTSTRAP.md gained "Quick Path: Cloning Engine (v3.5+)" section.
- AGENTS.md gained top-level "Workspace Safety" section.
- README.md regenerated from templates (replaces "GitHub-based operational workspace template" framing).
- 28 skills now in framework (up from 11 in v3.0); 11 packages (up from 9).

### Added (framework infrastructure)
- .github/workflows/{validate,drift}.yml — CI on push/PR + weekly scheduled drift report.
- .github/hooks/pre-commit.sh — installable via `npm run install:hooks`.
- tests/ directory with 23 node:test cases.
- npm scripts added: vault:snapshot, vault:audit, knowledge:{compile,index,lint,normalize,update-index}, check:divergence, selftest, version:check, install:hooks, generate:skills, sync:packages, render:templates, clone:framework, test.

### Fixed
- Duplicate `initialize` entry in package.json scripts.
- Missing .well-known/dao.json (was only .template).
- Pre-commit hook tolerates missing scripts/validate-identity.mjs (was hard-failing before P12 landed it).

## [3.0.0] — 2026-04-24

First tagged release under the proper versioning system. Consolidates the work done since the v2.0.0 launch and inaugurates org-os as a self-hosting, multi-instance orchestration hub.

### Added

- **Versioning system.** `docs/VERSIONING.md` policy, this `CHANGELOG.md`, `scripts/update-version.mjs`, `scripts/migrations/`, and a `validate:structure` consistency check.
- **Self-hosting inauguration.** Stubs in `SOUL.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md` replaced with real org-os-development content. `BOOTSTRAP.md` gained a bootstrap-done note.
- **Instance orchestration layer.** Three new framework-only registries: `data/instances.yaml` (per-instance state), `data/skills-matrix.yaml` (cross-instance skill catalog), `data/packages-matrix.yaml` (cross-instance package catalog). Documented in `docs/DATA-MODEL.md` → "Framework-only registries".
- **`npm run analyze:instances`** — scans every downstream instance for drift, writes a dated report to `memory/reports/`.
- **`workstream` frontmatter field** on all plans in `docs/agent-plans/`. Ties specific plans to long-lived workstreams in `data/projects.yaml`.
- **`docs/SKILL-PROMOTION.md`** — criteria and workflow for promoting skills from instance-local to framework-canonical.
- **`docs/agent-plans/README.md`** — documents the plan-pipeline conventions.
- **Three new workstreams in `data/projects.yaml`:** `instance-orchestration`, `skill-promotion`, `opal-rollout`, `operator-interfaces`.
- **Four new scoping plans:** `obsidian-interface`, `obsidian-canvas-interface`, `versioning-system`, plus earlier `framework-dashboard-template`.
- **`dashboard.yaml` custom sections** for instances, skill-promotion candidates, and package-promotion candidates (tuned for the framework/orchestration-hub view).
- **`federation.yaml` rewired** to reflect framework-upstream + orchestration-hub role. All 5 known downstream instances enumerated: `refi-bcn-os`, `refi-dao-os`, `dao-os`, `openclaw`, `regen-coordination-os`.
- **`scripts/initialize.mjs` extended** to load ideas, instances, and skill candidates into the state payload.

### Changed

- **`package.json.version`** bumped `2.0.0` → `3.0.0` to reconcile with `federation.yaml.metadata.framework_version` which had already moved to `3.0`.
- **`federation.yaml` v3.0 spec** formalized: `identity.role` field, `downstream` array with per-instance `cloned`/`local_path`/`sync_direction`, `agent.skills` aligned with the actual `skills/` directory (10 entries, previously listed 6).
- **`/initialize` behavior** now controlled by `dashboard.yaml` sections (started in v2 via commit `1b2f7e4`; formalized here). Sections can be toggled and reordered without code changes.

### Fixed

- `federation.yaml` agent skills list no longer drifts from reality.
- `scripts/initialize.mjs` no longer emits empty `ideas` / `instances` arrays when those registries are populated.

### Breaking

- Downstream instances should run `npm run migrate` to pick up the `workstream` frontmatter convention and (if they host the framework-only registries) seed them.
- The migration path is documented in [`docs/migrations/v2-to-v3.md`](docs/migrations/v2-to-v3.md).

## [2.0.0] — 2026-04-06

Framework standards release. Published as the foundation all v2 instances build on.

### Added

- **v2.0.0 framework documentation suite:** `docs/FILE-STRUCTURE.md`, `docs/DATA-MODEL.md`, `docs/AGENTIC-ARCHITECTURE.md`, `docs/SKILL-SPECIFICATION.md`, `docs/FEDERATION.md`, `docs/OPERATOR-GUIDE.md`, and more.
- **13 canonical data registries** with schema templates: `members`, `projects`, `finances`, `governance`, `meetings`, `ideas` (required); `funding-opportunities`, `relationships`, `sources`, `knowledge-manifest`, `events`, `channels`, `assets` (optional).
- **EIP-4824 schema generator** — `scripts/generate-all-schemas.mjs` emits `.well-known/*.json` from `data/*.yaml`.
- **Plan pipeline** — `docs/agent-plans/` with `scoping → queued → active → completed` lifecycle (commit `d1028ec` / `c80b3dc`).
- **10 core skills:** `bootstrap-interviewer`, `capital-flow`, `funding-scout`, `heartbeat-monitor`, `idea-scout`, `knowledge-curator`, `meeting-processor`, `org-os-init`, `schema-generator`, `workspace-improver`.
- **Session lifecycle** — `/initialize` and `/close` slash commands powered by the `org-os-init` skill.
- **`scripts/validate-structure.mjs`** — validates an instance against the canonical spec.

## Pre-v2.0.0

Incubation. See git history for granular changes. Notable milestones:

- `ef40d06` — first `/initialize` dashboard command with Notion integration.
- `a31b336` — full session lifecycle with apps, auto-sync, and `/close`.
- `ff5f568` — unified agent models framework.
- `a2feec4` — egregore, koi, opal integrations landed.
- `12ef2f9` — 4 Regen agents + knowledge initiation plan.

[Unreleased]: https://github.com/regen-coordination/org-os-template/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/regen-coordination/org-os-template/compare/archive/v3.5.0...v0.5.0
[3.5.0]: https://github.com/regen-coordination/org-os-template/compare/v3.0.0...v3.5.0
[3.0.0]: https://github.com/regen-coordination/org-os-template/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/regen-coordination/org-os-template/releases/tag/v2.0.0
