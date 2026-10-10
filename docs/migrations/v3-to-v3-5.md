# Migration: v3.0 → v3.5

> **Version numbering: this page speaks in the legacy line (`1.x → 2.x → 3.x → 3.5`).** In 2026-06 the framework renumbered itself `3.5 → 0.5` (see [VERSIONING.md](../VERSIONING.md) and `VERSION.md`); `0.5` is the current framework and is *later* than `3.5`. "v3.5" below means the fourth milestone of the old line.
>
> **Does an operator still need this page?** Rarely. The current framework already contains everything v3.5 introduced. What may still apply is the migration script: an older instance that lacks `genesis_commit` or `last_sync_commit` in `federation.yaml.metadata`, or has `data/packages-matrix.yaml` entries without `lifecycle_status`, can have them seeded by running `scripts/migrations/v3-to-v3-5-consolidation.mjs` (see below). For moving an instance onto the current framework, use `npm run doctor -- sync --dry-run` and then `npm run doctor -- sync` (see [VERSIONING.md](../VERSIONING.md)). The step list below is kept as the historical procedure, with the commands that no longer work as written corrected.

**Status:** additive only. Re-runnable. No deletions.

## What v3.5 added

The v3.5 release was themed "Consolidation + Ready for Real Orgs". See `CHANGELOG.md` (the `[0.5.0]` entry covers the renumbering) for the inventory. Highlights, taken from the old page and not re-counted:

- **Lineage stamp** in `federation.yaml.metadata` — every instance gets `genesis_commit` (immutable) + `last_sync_commit` (mutable). This enables federated tooling to reason about how instances relate to framework history.
- **Cloning engine** (`scripts/clone-framework.mjs`) — generate a new instance from a config file end-to-end.
- **Sync engine** (`scripts/sync-upstream.mjs`) — pull-based framework → instance synchronization with vault-safety + .sync-freeze + lineage-stamp update + receipt logging.
- **Reliability layer** — `scripts/selftest.mjs` aggregator, pre-commit hooks, CI workflows.
- **Skills section** — operator-visible inventory (`/skills`, `SKILLS.md`, `.well-known/skills.json`).
- **Package lifecycle** — `data/packages-matrix.yaml` gains `lifecycle_status` field.
- **Promoted skills and scripts** — skills and scripts moved from instance-local to framework-canonical (see [SKILL-PROMOTION.md](../SKILL-PROMOTION.md)).
- **Workspace safety promoted** from one hub to the framework (`scripts/vault-snapshot.mjs`, `vault-audit.mjs`, [VAULT-SAFETY.md](../VAULT-SAFETY.md)).

## What operators need to do

**Per instance**, to apply the v3.5 changes to an old instance:

```bash
# 1. Snapshot (it records tracked and staged files only; commit or copy aside untracked notes first)
npm run vault:snapshot -- "before v3.5 migration"

# 2. Bring in the framework changes (refuses on a dirty tree; see `npm run sync:upstream` in COMMANDS.md)
npm run sync:upstream -- --yes

# 3. Run the migration script directly (idempotent, additive)
node scripts/migrations/v3-to-v3-5-consolidation.mjs

# 4. Validate
npm run validate:structure
npm run validate:schemas
npm run selftest

# 5. If validators pass, commit the paths the script touched
git add federation.yaml data/packages-matrix.yaml memory/migrations-*.md   # drop data/packages-matrix.yaml if your instance has none: git add fails on a missing path
git commit -m "chore: apply the v3.5 lineage and lifecycle migration"
```

Two corrections to the old procedure. `git pull upstream main` is replaced by `npm run sync:upstream`, the supported route; that script also refuses to run on a dirty tree. And `npm run migrate -- --target v3.5` does not exist: `migrate.mjs` only knows `--dry`, ignores other arguments, and does not select `v3-to-v3-5-consolidation.mjs` when the framework is on `0.5` (it reads the file name as `3.0 → 3.0`). Run the script with `node`.

## What the migration does (mechanically)

`scripts/migrations/v3-to-v3-5-consolidation.mjs` performs:

1. **Seeds `federation.yaml.metadata.genesis_commit`** if missing — derives from `git rev-list --max-parents=0 HEAD | tail -1` of the instance. Treat as immutable after seeding.
2. **Seeds `federation.yaml.metadata.last_sync_commit`** to `null` if missing. Updated to the framework HEAD SHA on the next `sync:upstream` run.
3. **Adds `lifecycle_status: "dormant"`** to any `data/packages-matrix.yaml` entries missing the field. Operator should review and adjust (active/dormant/planned/retired).
4. **Logs everything** to `memory/migrations-YYYY-MM-DD.md`.

The migration does **NOT**:

- Change `framework_version` (edit it yourself, or let `npm run doctor sync` re-stamp it)
- Touch `data/skills-matrix.yaml` (instances own their own; framework's is separate)
- Modify any skill or package content
- Delete or rename anything

## Per-instance cascade order (recommended)

If you maintain multiple instances, sequence them by blast radius:

1. **Smallest / lowest-risk first** (e.g., bootstrap instances with no production operations)
2. **Hubs / coordination instances** (high alignment with framework patterns)
3. **Active production instances** (only after operator opts in)
4. **Time-critical instances** — never sync during a critical operational window. Use the `.sync-freeze` lockfile to enforce:
   ```bash
   echo "DO NOT SYNC UNTIL <date>: <reason>" > .sync-freeze
   ```
   `sync-upstream` will refuse with exit code 2 until you remove the file.

## Rollback

If sync introduces a regression and you can't fix forward:

1. **Find your snapshot ref:** `git for-each-ref refs/snapshots/` (the snapshot from step 1 above)
2. **Restore individual files:** `git cat-file -p refs/snapshots/<your-ref>:"<file>" > "<file>.recovered"`, then compare with the current file before replacing it. A plain `> "<file>"` overwrites silently.
3. **Or restore more broadly:** see the recovery runbook in [VAULT-SAFETY.md](../VAULT-SAFETY.md)

The migration is additive, so most rollbacks just need a `git revert` of the commit in which you recorded the sync (`sync:upstream` leaves its changes uncommitted, so there may be none).

## After successful sync

- Re-run `/initialize` to refresh the dashboard
- Check `npm run check:divergence` — it lists, advisorily, which of your scripts differ from the framework's
- Consider enabling pre-commit hooks: `npm run install:hooks`
- If you want auto-discovery of skills: `npm run generate:skills` writes `SKILLS.md` + `.well-known/skills.json`

## Known issues

- Pre-existing instance scripts may diverge from framework canonical (intentional or drift). `npm run check:divergence` surfaces these advisorily. Resolution is operator-driven, not automated.
- [SKILL-PROMOTION.md](../SKILL-PROMOTION.md) keeps a "Known divergences" table, written at the v3.5.0 release and not re-checked.

## References

- [CHANGELOG.md](../../CHANGELOG.md) — release history, including the `0.x` re-baseline
- [VERSIONING.md](../VERSIONING.md) — versioning policy, lineage stamp, version surfaces
- [RELIABILITY.md](../RELIABILITY.md) — failure modes, trigger layers, recovery
- [VAULT-SAFETY.md](../VAULT-SAFETY.md) — workspace safety protocol and recovery runbook
- [PACKAGE-LIFECYCLE.md](../PACKAGE-LIFECYCLE.md) — package lifecycle states and sync mechanism
- [SKILL-PROMOTION.md](../SKILL-PROMOTION.md) — skill and script promotion workflow
