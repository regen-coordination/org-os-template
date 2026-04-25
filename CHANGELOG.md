# Changelog

All notable changes to **org-os** (the framework) are documented here. This project follows [Semantic Versioning](https://semver.org) and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

For the policy that governs what counts as a version bump, see [`docs/VERSIONING.md`](docs/VERSIONING.md).

## [Unreleased]

_(Append changes here as they land. On release, `npm run version:update <version>` promotes this to a versioned section.)_

## [3.5.0] — 2026-04-25

> **Theme:** "Ready for Real Orgs" — instances can be cleanly cloned, packages
> materialized, validators CI-enforced. Proven by `bread-coop-os` going live.

### Added
- **Cloning engine** (`scripts/clone-framework.mjs`) — single source of truth
  for bootstrapping new instances; supports `--interactive`, `--non-interactive
  --config`, `--dry-run`, `--force`
- **Package consumption mechanism** (`scripts/sync-packages.mjs`,
  `npm run sync:packages`) — vendored packages with framework_version pinning,
  `--check` and `--prune` flags
- **Reliability layer**:
  - Pre-commit hook (`.github/hooks/pre-commit.sh` + `npm run install:hooks`)
  - CI workflow (`.github/workflows/validate.yml`) — runs on push + PR
  - Scheduled drift workflow (`.github/workflows/drift.yml`) — Sundays 04:00 UTC
  - `npm run selftest` aggregator (validators + clone-engine dry-run + version:check)
- **One-pager templates** in `templates/`:
  - `README.framework.md`, `README.instance.md` — variant templates
  - `GETTING-STARTED.md` — conversational onboarding (conditional by org type)
  - `partials/` — shared cheatsheet + federation snippets
  - `render.mjs` — minimal Mustache-style renderer (~80 lines)
- **`docs/PACKAGE-LIFECYCLE.md`** — promotion + retirement workflow for packages
  (mirrors `docs/SKILL-PROMOTION.md`)
- **`docs/RELIABILITY.md`** — failure modes, trigger layers, recovery runbook
- **`lifecycle_status` field** on `data/packages-matrix.yaml` (active/dormant/
  planned/retired) + validator enforcement
- **`bread-coop-os`** — new instance, bootstrapped via the cloning engine
  (v3.5 acceptance test)
- **GitHub Template wrapping** — Issue form + workflow for browser-based bootstrap
- `--check` mode in `scripts/update-version.mjs` (verifies CHANGELOG sync)
- `--check-only` and `--report` modes in `scripts/analyze-instances.mjs`
- `version:check` npm script

### Changed
- **`README.md`** — replaced v1-era content with rendered framework template
- **`GETTING-STARTED.md`** — new at repo root, rendered from template
- **`BOOTSTRAP.md`** — rewrote to point at the cloning engine
- **`bootstrap-interviewer` skill** — extended with package + skill selection
- **`scripts/sync-upstream.mjs`** — now delegates to `sync-packages`
- **`dashboard` package** — promoted to framework (was: refi-bcn-os origin),
  used by 3 instances
- **`packages-matrix.yaml`** — added `coop` and `regen-toolkit` entries
  surfaced by audit; corrected `instances_using` for 10 packages to reflect
  regen-coordination-os adoption

### Fixed
- `.well-known/dao.json` — added (was missing, blocking validate:structure)
- `federation.yaml` — added required federation section wrapper
- `package.json` — deduped `initialize` script entry

### Reliability SLAs (new)
- Drifted: `last_sync` > 30 days
- Dormant: `last_sync` > 90 days

### Migration
- Additive release. No breaking changes for existing instances.
- Existing instances pull v3.5 via `npm run sync:upstream`.
- Run `npm run install:hooks` to enable the pre-commit hook locally.
- v3.0 instances should run `npm run sync:upstream` after upgrade to pick up
  the new templates, scripts, and workflows.

### Known issues
- Framework's own `federation.yaml.packages` block uses stale module-style
  toggles (legacy v2 names) — does not block functionality but should be
  migrated to v3.5 package IDs in v3.5.1.
- Selftest's `analyze:instances` step exits non-zero from the framework
  worktree due to instance `local_path_missing` items — will resolve once all
  instances re-sync against v3.5 (Phase 3 of release plan).

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

[Unreleased]: https://github.com/regen-coordination/org-os-template/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/regen-coordination/org-os-template/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/regen-coordination/org-os-template/releases/tag/v2.0.0
