# Versioning Policy

**Status:** active since v3.0.0 (2026-04-24)

## TL;DR

- Framework version = `package.json.version` — this is the **single source of truth**.
- `federation.yaml.metadata.framework_version` mirrors major.minor of the above. Enforced by `validate:structure`.
- Data schemas, skills, and per-instance mandates (`MASTERPLAN.md`) version **independently**.
- Strict semver. Breaking changes bump major. Document every change in `CHANGELOG.md`.
- Downstream instances **pull** migrations, they don't get pushed.

## Sources of version truth

| Version | Where it lives | Scope |
|---|---|---|
| Framework | `package.json.version` | The whole framework (code + canonical docs + standards) |
| Framework (mirror) | `federation.yaml.metadata.framework_version` | Major.minor of framework, visible to federated peers |
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

When it's time to cut a release:

```bash
# 1. All work merged to main, working tree clean
git status                        # must be clean

# 2. Bump version and update metadata + changelog stub
npm run version:update 3.1.0       # or 3.0.1 / 4.0.0 etc.

# 3. Hand-edit CHANGELOG.md to replace the stub with real content

# 4. Review the diff
git diff

# 5. Commit the release
git add -A
git commit -m "release: v3.1.0"

# 6. Tag locally (do not push the tag until publishing publicly)
git tag -a v3.1.0 -m "v3.1.0"

# 7. (optional) Publish
git push
git push origin v3.1.0
```

`version:update` does NOT push anything. That's always manual.

## Pre-1.0 and 0.x

Not applicable. The framework is at `3.x`. If a future major rewrite justified it, a `reset to 0.x` would be called out explicitly as a breaking change and require the same migration machinery.

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
  framework_version: "3.5"       # major.minor of the framework this instance is on
  genesis_commit: "<40-hex SHA>" # framework commit at clone time; immutable
  last_sync_commit: "<SHA>|null" # framework commit pinned at last sync-upstream run
```

- **`genesis_commit`** is set by `scripts/clone-framework.mjs` at bootstrap (from `git rev-list --max-parents=0 HEAD | tail -1` on the framework). It never changes for an instance.
- **`last_sync_commit`** is updated by `scripts/sync-upstream.mjs` after every successful sync. `null` means "never synced" (either freshly cloned, or the framework itself, which is its own upstream).
- `scripts/validate-identity.mjs` (run via `npm run validate:schemas`) checks shape: 40-hex SHA for genesis, 40-hex SHA or null for last_sync.

## Version triplet sanity (v3.5+)

Three sources must agree on framework version:

1. `package.json` → `version` (semver, e.g., `3.5.0`)
2. `federation.yaml` → `metadata.framework_version` (major.minor, e.g., `3.5`)
3. `CHANGELOG.md` → most-recent `## [X.Y.Z]` heading

Check via:

```bash
npm run version:check
```

Exit code 1 on any inconsistency. Run before tagging any release.
