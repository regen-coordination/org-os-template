# Versioning Policy

**Status:** active · rewritten 2026-08-28 for the `0.x` pre-beta line (v0.5 WS-C1)

## TL;DR

- The framework is on the **`0.x` pre-beta line**. Current: `0.5.0`.
- Framework version = `package.json.version` — this is the **single source of truth**.
- Four other surfaces mirror it and are machine-checked by `npm run version:check`.
- `0.minor` = **milestone number**, not a semver minor. `1.0.0` is reserved.
- The legacy `1.x → 3.5` line is **historical**. `0.5 < 3.5` is deliberate, not a regression.
- Data schemas, skills, and per-instance mandates (`MASTERPLAN.md`) version **independently**.
- Downstream instances **pull** migrations, they don't get pushed.

## The `0.x` pre-beta line (current)

On **2026-06-17** org-os renumbered itself `3.5 → 0.5`. This was deliberate and
non-SemVer: the version was overstating the project's maturity, and `3.x` read as
"third stable generation" to anyone encountering it cold. `0.x` says the true thing —
pre-1.0, interfaces still moving, adopt with your eyes open.

**`0.minor` is a milestone counter, not a semver minor.** The line previously numbered
`1.x → 2.x → 3.x → 3.5` was four milestones; `0.5` is the fifth. So:

| Milestone | Legacy number | Current number |
|---:|---|---|
| 1 | `1.x` | — historical |
| 2 | `2.x` | — historical |
| 3 | `3.0` | — historical |
| 4 | `3.5` | — historical |
| 5 | — | **`0.5`** |
| 6 | — | `0.6` |

**This table is the map, and it has one source of truth: the `[0.5.0]` entry in
[`CHANGELOG.md`](../CHANGELOG.md).** This section restates it; `packages/instance-doctor`
implements it in `checks/versions.mjs`. Do not write a third copy — a version map that
disagrees with itself is worse than none, and cross-scheme comparison is exactly where
that bites (a naive semver compare reads an instance on `3.0` as *ahead* of a framework
on `0.5`).

**`0.5 < 3.5` is intentional.** SemVer ordering does not apply across the re-baseline.
Sorted tag lists are the practical hazard: historical tags are therefore published as
`archive/v3.0.0` and `archive/v3.5.0`, never bare, so they cannot outrank `v0.5.0`.

### What bumps what, on the 0.x line

- **`0.(n+1)`** — a milestone: a coherent body of work shipped together, announced in
  `CHANGELOG.md`. Breaking changes are allowed here and are called out with a migration.
- **`0.n.p`** — a patch: fixes and additions that break nothing.
- **`1.0.0`** — **reserved.** Not a bigger number; a claim. It means the framework has
  been run by operators who are not its author, its interfaces have stopped moving, and
  breaking changes have become genuinely exceptional. The v0.6 external-pilot gate is a
  step toward it, not the thing itself.

### Historical: the `1.x → 3.5` line

Superseded by the re-baseline above and kept only so old references resolve. Anything
still claiming `3.0` or `3.5` — an instance's `framework_version`, a stale doc, a
sync receipt — is on the legacy scheme and is *behind* `0.5`, by the milestone table.
`doctor assess` reports this as `framework-version-stale` with the milestone distance.

## Sources of version truth

| Version | Where it lives | Scope |
|---|---|---|
| Framework | `package.json.version` | The whole framework (code + canonical docs + standards) — **the source of truth** |
| Framework (mirror) | `federation.yaml.metadata.framework_version` | Major.minor of framework, visible to federated peers |
| Framework (mirror) | `CHANGELOG.md` most-recent `## [X.Y.Z]` | The released milestone |
| Framework (mirror) | `VERSION.md` → `**Framework Version:**` | Human-facing version page |
| Framework (mirror) | `MASTERPLAN.md` → `**Version:**` header | The framework's own mandate file (see below) |
| Data schema | `schema_version` in each `data/*.yaml` | One schema per registry; bumps when that registry's shape changes |
| Skill | `version` in each `skills/<name>/SKILL.md` frontmatter | Per-skill; bumps independently |
| Instance mandate | `MASTERPLAN.md` version header | Per-instance; tracks how each instance evolves its own agent mandate |

These are **decoupled**. A patch to the framework doesn't touch any schema or skill version. A skill rewrite bumps only that skill. A new data registry bumps the framework (minor) and the new registry starts at `schema_version: "1.0"`.

## Semver rules

Follow [semver.org](https://semver.org) strictly. Definitions in framework context:

### Major (`X.0.0`) — breaking

- Remove or rename a required field in a data schema.
- Rename a canonical file (e.g., `SOUL.md` → something else).
- Remove a canonical registry from the data model.
- Break a skill interface that instances depend on.
- Remove a script referenced in `package.json.scripts`.
- Change the federation protocol exchange format incompatibly.

Breaking changes require:
- A migration script under `scripts/migrations/vX-to-vY.mjs`.
- A migration doc under `docs/migrations/vX-to-vY.md`.
- A `BREAKING CHANGES` section in the `CHANGELOG.md` entry.

### Minor (`X.Y.0`) — additive

- Add a new optional field to a data schema.
- Add a new canonical registry.
- Add a new skill to `skills/`.
- Add a new framework-level package under `packages/`.
- Add a new script to `package.json.scripts`.
- Add a new section to an existing canonical file.
- Any change visible to operating instances that isn't a bugfix.

### Patch (`X.Y.Z`) — safe

- Bugfix in a script, skill implementation, or validator.
- Doc-only changes (typo, clarification).
- Internal refactor with no instance-visible effect.

### What's *not* a version bump

- Session memory writes (`memory/`), heartbeat updates (`HEARTBEAT.md`), dated reports.
- Content of `data/*.yaml` — only the *shape* is versioned, not the entries.
- Plan files in `docs/agent-plans/` — those have their own lifecycle.

## Instance migration — pull-based

The framework does **not** push changes to downstream instances. Each instance pulls at its own cadence:

1. Framework ships a release (version bump + CHANGELOG + migration scripts + docs).
2. Instance operator runs `npm run sync:upstream` (or git pulls the template remote).
3. Instance operator runs `npm run migrate` — detects local `framework_version`, applies every migration script from there to the current framework version, idempotent.
4. Instance's `federation.yaml.metadata.framework_version` is updated to the new version.
5. Framework hub (this repo) picks up the new state on next `npm run analyze:instances`.

> **Note (2026-08-02):** `npm run sync:upstream` is implemented and now
> covered by tests (`tests/scripts/sync-upstream.test.mjs`, autopoiesis
> Phase 2 pilot). After a sync, `federation.yaml.metadata.last_sync_commit`
> records the upstream HEAD that was merged (and `genesis_commit` is seeded
> if the instance never recorded one), and a sync receipt lands in
> `memory/sync-YYYY-MM-DD.md`. The sync leaves these changes uncommitted
> for operator review.

Migrations must be:
- **Idempotent** — running twice does nothing the second time.
- **Additive where possible** — never delete data without a `--destructive` flag.
- **Logged** — append a line to `memory/migrations-YYYY-MM-DD.md` on the instance.

## `MASTERPLAN.md` version vs framework version

These are different and both matter:

- `package.json.version` = framework version (shared by all instances of this codebase).
- `MASTERPLAN.md` version header = that specific instance's agent-mandate version. A refi-bcn-os at `MASTERPLAN v2.0.0` and refi-dao-os at `v2.2.0` can both run framework `v3.0.0`. They describe the evolution of the *organization's mandate*, not the framework.

Rule of thumb: if you changed how the framework works → framework version. If you changed what the organization wants its agent to do → MASTERPLAN version.

## Skill versions

Each skill under `skills/<name>/SKILL.md` carries its own semver in frontmatter:

```yaml
---
name: research
version: "1.2.0"
...
---
```

Rules:
- Skill version is independent of framework version.
- A skill can bump patch without a framework release (via `patch` hotfix).
- Promoting an instance-local skill to framework-canonical (see `docs/SKILL-PROMOTION.md`) starts it at `1.0.0` unless the source skill was already further along and well-maintained.

## Release process

Write the changelog **as work lands**, under `## [Unreleased]`. `version:update` promotes that
section to a dated release heading — so at release time there is nothing to author, which is what
makes cutting a tag a short job instead of an archaeology session.

```bash
# 1. All work merged to main, working tree clean
git switch main && git fetch && git merge --ff-only origin/main
git status                                  # must be clean

# 2. Prove it. The tag claims this suite is green — run it, don't assume.
npm test && npm run validate:schemas && npm run validate:structure \
  && npm run selftest && npm run test:admin \
  && (cd site && npm run build && npm test)
gh run list --workflow=validate.yml --limit 1   # and a GREEN CI run on this commit

# 3. Pause the crons that commit straight to main (they have raced a release)
gh workflow disable drift.yml
gh workflow disable generate-schemas.yml

# 4. Snapshot, then bump. version:update rewrites the five version surfaces and
#    promotes [Unreleased] → [<version>] — <date> with comparison links.
npm run vault:snapshot -- "v0.5.1 release point"
npm run version:update 0.5.1
npm run version:check                       # all five surfaces must agree

# 5. Review, then commit with EXPLICIT paths (never `git add -A` here)
git diff
git add package.json federation.yaml CHANGELOG.md VERSION.md MASTERPLAN.md
git commit -m "release: v0.5.1"

# 6. Re-check for a race immediately before tagging, then tag and publish
git fetch && git merge --ff-only origin/main
git tag -a v0.5.1 -m "org-os v0.5.1 — <one line>"
git push origin main --follow-tags

# 7. Unpause the crons, verify nothing was lost
gh workflow enable drift.yml
gh workflow enable generate-schemas.yml
npm run vault:audit
```

`version:update` does NOT commit, tag, or push. That is always manual.

**Hard-won rules, all from the v0.5.0 ship (2026-08-29):**

- **Acceptance gates the tag, not the other way round.** If the release claims something works,
  prove it against something real *before* tagging — and if the proof fails, narrow the claim or
  delay. v0.5.0's own acceptance failed and the tag waited; the sync claim shipped scoped to what
  was actually demonstrated, with the gap documented under Known issues.
- **A green local suite is not a green CI run.** `validate.yml` was red for a day while local runs
  passed, because the developer's global git identity masked a fixture defect runners hit.
- **Never re-push a bare historical tag.** Old lines are published as `archive/vX.Y.Z` only —
  a bare `v3.5.0` would outrank `v0.5.0` in semver-sorted lists and undo the one-versioning story
  at the surface newcomers see.
- **Hand-written reports must not use a generator's filename.** `analyze:instances` owns
  `memory/reports/instances-drift-<date>.md` and regenerates it on every gate run; an acceptance
  report written there was overwritten mid-session.
- **Expect `main` to move under you.** Concurrent sessions and the weekly bot both commit directly;
  re-fetch immediately before the tag (step 6), not just at the start.

## Pre-1.0 and 0.x

See [The `0.x` pre-beta line (current)](#the-0x-pre-beta-line-current) above — this is
now the framework's actual line, not a hypothetical. (Until 2026-08-28 this section read
"Not applicable. The framework is at `3.x`", eleven weeks after the re-baseline. Kept as
a marker of why `version:check` now reads every surface it can.)

## Enforcement

`npm run validate:structure` fails if:
- `package.json.version` is missing or malformed.
- `federation.yaml.metadata.framework_version` does not equal `package.json.version` major.minor.
- A `CHANGELOG.md` entry for the current version is missing when the tag exists.

## References

- [semver.org](https://semver.org) — semantic versioning spec.
- [keepachangelog.com](https://keepachangelog.com) — CHANGELOG format.
- `docs/SKILL-PROMOTION.md` — how instance skills become canonical.
- `docs/PACKAGE-LIFECYCLE.md` — package lifecycle states + sync mechanism.
- `docs/DATA-MODEL.md` — registry schemas and their `schema_version` fields.

---

## Lineage stamp (v3.5+)

Every instance carries a **lineage stamp** in `federation.yaml.metadata`:

```yaml
metadata:
  framework_version: "0.5"       # major.minor of the framework this instance is on
  genesis_commit: "<40-hex SHA>" # framework commit at clone time; immutable
  last_sync_commit: "<SHA>|null" # framework commit pinned at last sync-upstream run
```

- **`genesis_commit`** is set by `scripts/clone-framework.mjs` at bootstrap (from `git rev-list --max-parents=0 HEAD | tail -1` on the framework). It never changes for an instance.
- **`last_sync_commit`** is updated by `scripts/sync-upstream.mjs` after every successful sync. `null` means "never synced" (either freshly cloned, or the framework itself, which is its own upstream).
- `scripts/validate-identity.mjs` (run via `npm run validate:schemas`) checks shape: 40-hex SHA for genesis, 40-hex SHA or null for last_sync.

## Version surface check (five surfaces since v0.5)

Every surface that states a framework version must agree on major.minor:

1. `package.json` → `version` (semver, e.g. `0.5.0`) — the source of truth
2. `federation.yaml` → `metadata.framework_version` (major.minor, e.g. `0.5`)
3. `CHANGELOG.md` → most-recent `## [X.Y.Z]` heading
4. `VERSION.md` → the `**Framework Version:**` line
5. `MASTERPLAN.md` → the `**Version:**` header

Surfaces 4 and 5 were added in v0.5 (WS-C5) because they were the two that had actually
drifted — `VERSION.md` said `1.0.0` and `MASTERPLAN.md` said `2.0.0` while the framework
was on `0.5.0`, and the three-surface check could not see either. A surface no check
reads is a surface that drifts unnoticed.

Both are optional: absent, or present without a version line, means "makes no claim" and
is not an error. That is what lets instances run the same check.

Check via:

```bash
npm run version:check
```

Exit code 1 on any inconsistency. Run before tagging any release.
