---
id: versioning-system
title: "Proper Versioning System"
status: completed
priority: 0
scope: framework
depends_on: []
created: 2026-04-24
started: 2026-04-24
completed: 2026-04-24
estimated_sessions: 1
tags: [versioning, infrastructure, migration, breaking-changes]
workstream: v2-stabilization
---

## Delivered

- `docs/VERSIONING.md` — policy. Single source of truth (`package.json.version`), decoupled schema/framework/skill/MASTERPLAN versions, strict semver, pull-based instance migrations, enforcement via `validate:structure`.
- `CHANGELOG.md` — Keep-a-Changelog format. Backfilled v2.0.0, wrote v3.0.0 entry, kept running `[Unreleased]` section.
- `package.json.version` bumped `2.0.0` → `3.0.0` to reconcile with `federation.yaml.metadata.framework_version`.
- `scripts/update-version.mjs` — fixes the previously-broken `npm run version:update` reference. Bumps package.json, syncs federation.yaml, promotes `[Unreleased]` to the new version in CHANGELOG. Does NOT commit/tag/push (manual).
- `scripts/migrate.mjs` — detects instance's framework_version vs current, runs applicable migrations from `scripts/migrations/`. Exposed as `npm run migrate`.
- `scripts/migrations/v2-to-v3-workstream-frontmatter.mjs` — idempotent migration that backfills `workstream:` frontmatter on plan files.
- `docs/migrations/v2-to-v3.md` — operator-facing migration guide.
- `scripts/validate-structure.mjs` section 8 — Version Consistency check (package.json version major.minor must match federation.yaml framework_version; warns if CHANGELOG or VERSIONING missing).

## Verification

- `npm run validate:structure` — new section 8 passes (3/3 checks).
- `npm run migrate --dry` — correctly reports "no migrations to run" (instance already at current version).
- `node scripts/migrations/v2-to-v3-workstream-frontmatter.mjs` — idempotent: reports "0 updated, 8 already migrated".

## Open questions answered (from scoping)

1. **2.0.0 vs 3.0** → bumped package.json to **3.0.0** (matches federation.yaml target).
2. **Pre-1.0 or post-1.0** → post-1.0; committed to 3.x.
3. **Schema vs framework versions** → **decoupled**.
4. **Instance migration** → **pull-based** via `npm run migrate`.
5. **MASTERPLAN.md version** → separate from framework; documented.
6. **Skill versions** → independent, per-`SKILL.md` frontmatter.
7. **Breaking-change policy** → strict semver; policy codified in `docs/VERSIONING.md`.

## Follow-ups

- Create local `v3.0.0` tag (done in this session).
- Add a CHANGELOG check to CI if/when CI lands.
- On next real release, edit the `[Unreleased]` stub before running `version:update`.

## Goal

Establish a real versioning system for org-os so that the framework, each instance, each schema, and each skill have explicit, comparable versions — with migration guides for every breaking change.

## Why

Today's state:
- `package.json` says `2.0.0`. `federation.yaml.metadata.framework_version` says `3.0`. These disagree.
- Instances declare `framework_version` (refi-bcn, refi-dao, dao-os: `3.0`; openclaw: none) but there's no tooling to detect when an instance is behind or to migrate it.
- `MASTERPLAN.md` says v2.0.0, refi-dao-os's MASTERPLAN says v2.2.0 — version numbers are per-file and not reconciled.
- `scripts/update-version.mjs` is referenced in `package.json` but doesn't exist (broken script).
- Breaking changes to the data model (e.g., adding `workstream` frontmatter to plans) have no written migration path.
- No changelog; no release notes; no git tags.

## Output shape (proposal)

1. **Single source of version truth** — `package.json.version` is canonical. All other version mentions read from it (or are generated from it).
2. **Framework version field convention** — `federation.yaml.metadata.framework_version` MUST equal `package.json.version` major.minor. Validated by `validate:structure`.
3. **Schema version per registry** — each `data/*.yaml` already has `schema_version: "2.0"`. Document which framework versions each schema version is compatible with.
4. **Skill version** — each `SKILL.md` frontmatter has a `version:` field (already exists in some). Standardize format.
5. **Instance tracking** — `data/instances.yaml.framework_version` + `last_sync` let us compute per-instance lag. Surface in `analyze:instances`.
6. **Migration guides** — `docs/migrations/vX-to-vY.md` per breaking change. Required field: "Who needs to act, what they run, how to verify."
7. **CHANGELOG.md** — at repo root, Keep-a-Changelog format. Every PR that affects users adds a line.
8. **Git tags + releases** — `vX.Y.Z` tag on main when version bumps. GitHub Release with changelog excerpt.
9. **Version bump script** — `npm run version:update` (currently broken) fixed: updates `package.json`, `federation.yaml`, tags commit, appends CHANGELOG stub.
10. **Semver policy** — document the policy: what's a major bump vs minor vs patch in the context of a framework+template repo. (Breaking data model → major. New registry → minor. Bugfix → patch. Instance-visible changes always minor minimum.)

## Open questions (to resolve before moving to queued)

1. **Reconcile 2.0.0 vs 3.0** — which is correct today? (Probably `3.0` based on federation.yaml being more current. Bump `package.json` to `3.0.0`?)
2. **Pre-1.0 or post-1.0 semver?** — if we reset to `0.x`, breaking changes don't need majors. Or commit to `3.x` already.
3. **Schema versions: decoupled or coupled** — does bumping framework version force bumping `schema_version` in all data files? Or are they independent?
4. **Instance migration — push or pull?** — does the framework publish migration PRs to instances, or do instances pull? (Probably pull via `sync:upstream`; but framework provides migration script.)
5. **`MASTERPLAN.md` version** — per-instance mandate versioning is separate from framework versioning. Keep separate? Rename to avoid confusion?
6. **Skill versions — independent or framework-coupled?** — a skill might bug-fix without framework release. Allow independent versioning?
7. **What's breaking?** — need a written policy: e.g., "removing a required field from a data schema is major; adding an optional field is minor; renaming a file is major."

## Related plans

- **`v2-stabilization`** (parent workstream) — versioning is foundational to calling any version "stable."
- **`federation-protocol`** (queued) — peer sync needs version-compatibility rules.
- **`instance-orchestration`** — `analyze:instances` will surface version drift once this lands.

## Tasks (preliminary)

- [ ] Answer open questions above
- [ ] Reconcile current version numbers (pick 2.0.0 or 3.0.0)
- [ ] Write semver policy (`docs/VERSIONING.md`)
- [ ] Create `docs/migrations/` directory with first backfill migration (v2 data model → workstream frontmatter)
- [ ] Create `CHANGELOG.md`
- [ ] Fix / write `scripts/update-version.mjs`
- [ ] Add version-consistency check to `validate:structure`
- [ ] Tag current commit as first real release after all of the above

## Out of scope

- Versioning of linked knowledge repos (e.g., ReFi-Barcelona) — they version independently.
- OPAL integration versioning — OPAL has its own version; we pin a compatibility range in `integrations/opal/README.md`.
- Versioning for every instance-specific data extension — instances pick their own scheme.
