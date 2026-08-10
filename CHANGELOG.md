# Changelog

All notable changes to **org-os** (the framework) are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org) within a given line — but note the **2026-06-17 `0.x` pre-beta re-baseline** (see `[0.5.0]`), a one-time deliberate, non-SemVer renumbering of `3.5 → 0.5`.

For the policy that governs what counts as a version bump, see [`docs/VERSIONING.md`](docs/VERSIONING.md).

## [Unreleased]

_(Append changes here as they land.)_

### Added

- **symbient v2** — practice promoted to framework capability: `skills/symbient/` (contract + vendored Quilt Protocol by Wib & Wob, CC BY-NC), `scripts/symbient-hatch.mjs` + `scripts/lib/symbient-gates.mjs`, conditional close-pulse in `/close`, hermes on-demand surfacing. Habitats are operator-private (gitignored); see `docs/superpowers/specs/2026-08-10-symbient-v2-design.md`.

## [0.5.0] — 2026-06-17

**Version-scheme re-baseline (deliberate, non-SemVer).** org-os adopts a `0.x` **pre-beta** scheme to honestly signal pre-1.0 maturity. The line previously numbered `1.x → 2.x → 3.x → 3.5` (four milestones) is hereby designated **v0.5** — the fifth milestone — aligning the framework's own version with the public **"org-os v0.5"** surface: the new website at `site/` plus the v0.5 module constellation (website-generator, kms, hermes, rad-org-os, members-hub, ideation). `0.5 < 3.5` is intentional and reflects "pre-beta," not a regression; SemVer ordering does not apply across this re-baseline.

### Changed
- `package.json` version: `3.5.0` → `0.5.0`.
- `federation.yaml` `metadata.framework_version`: `"3.5"` → `"0.5"`.
- `README.md` version header → `0.5.0 (pre-beta)`.
- Public site (`site/`): the v0.5 framework website ships as the first surface of this milestone; the home statline now reads `framework v0.5`.

### Follow-ups (flagged, not done here)
- `docs/VERSIONING.md` should formalize the `0.x` pre-beta policy (it still describes the `3.x` SemVer line).
- Downstream instances in `data/instances.yaml` still record their last-synced `framework_version` (`3.0`/`3.5`) — historical sync records, to be reconciled in a later federation sync.
- The in-flight `release/v3.5-*` branches predate this re-baseline and need separate reconciliation.

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

[Unreleased]: https://github.com/regen-coordination/org-os-template/compare/v3.5.0...HEAD
[3.5.0]: https://github.com/regen-coordination/org-os-template/compare/v3.0.0...v3.5.0
[3.0.0]: https://github.com/regen-coordination/org-os-template/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/regen-coordination/org-os-template/releases/tag/v2.0.0
