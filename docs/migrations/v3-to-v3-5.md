# Migration: v3.0 → v3.5

**Status:** additive only. Re-runnable. No breaking changes.

## What v3.5 adds

The v3.5 release is themed **"Consolidation + Ready for Real Orgs"**. See `CHANGELOG.md [3.5.0]` for the full inventory. Highlights:

- **Lineage stamp** in `federation.yaml.metadata` — every instance gets `genesis_commit` (immutable) + `last_sync_commit` (mutable). This enables federated tooling to reason about how instances relate to framework history.
- **Cloning engine** (`scripts/clone-framework.mjs`) — generate a new instance from a config file end-to-end.
- **Sync engine** (`scripts/sync-upstream.mjs`) — pull-based framework → instance synchronization with vault-safety + .sync-freeze + lineage-stamp update + receipt logging.
- **Reliability layer** — `scripts/selftest.mjs` aggregator, pre-commit hooks, CI workflows.
- **Skills section** — operator-visible inventory (`/skills`, `SKILLS.md`, `.well-known/skills.json`).
- **Package lifecycle** — `data/packages-matrix.yaml` gains `lifecycle_status` field.
- **Promoted skills + scripts** — 5 skills + 5 scripts moved from instance-local to framework-canonical.
- **Vault-safety promoted** from hub to framework (`scripts/vault-snapshot.mjs`, `vault-audit.mjs`, `docs/VAULT-SAFETY.md`).

## What operators need to do

**Per instance**, after pulling framework v3.5:

```bash
# 1. Take a safety snapshot (vault-safety protocol; mandatory)
npm run vault:snapshot -- "before v3.5 sync"

# 2. Pull the framework changes
git pull upstream main

# 3. Run the migration (idempotent, additive, no data loss)
npm run migrate -- --target v3.5

# 4. Validate
npm run validate:structure
npm run validate:schemas
npm run selftest

# 5. If validators pass, commit
git add federation.yaml data/packages-matrix.yaml memory/migrations-*.md
git commit -m "chore: sync to org-os v3.5.0"
```

## What the migration does (mechanically)

`scripts/migrations/v3-to-v3-5-consolidation.mjs` performs:

1. **Seeds `federation.yaml.metadata.genesis_commit`** if missing — derives from `git rev-list --max-parents=0 HEAD | tail -1`. Immutable after seeding.
2. **Seeds `federation.yaml.metadata.last_sync_commit`** to `null` if missing. Updated to the framework HEAD SHA on first `sync:upstream` run.
3. **Adds `lifecycle_status: "dormant"`** to any `data/packages-matrix.yaml` entries missing the field. Operator should review and adjust (active/dormant/planned/retired).
4. **Logs everything** to `memory/migrations-YYYY-MM-DD.md`.

The migration does **NOT**:

- Force `framework_version` upgrade (operator opts in by editing the field)
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
2. **Restore individual files:** `git cat-file -p refs/snapshots/<your-ref>:"<file>" > "<file>"`
3. **Or restore the whole tree:** see `docs/VAULT-SAFETY.md` recovery runbook

The migration is additive, so most rollbacks just need a `git revert` of the sync commit.

## After successful sync

- Re-run `/initialize` to refresh dashboard
- Check `npm run check:divergence` — script divergences from canonical are now visible and resolvable per-script
- Consider enabling pre-commit hooks: `npm run install:hooks`
- If you want auto-discovery of skills: `npm run generate:skills` writes `SKILLS.md` + `.well-known/skills.json`

## Known issues

- Pre-existing instance scripts may diverge from framework canonical (intentional or drift). `npm run check:divergence` surfaces these advisorily. Resolution is operator-driven, not automated.
- `refi-dao-os` has a known divergent `compile-knowledge.mjs` (md5: 73f9b36d…) — manually reconcile during cascade. See `docs/SKILL-PROMOTION.md` Known Divergences table.

## References

- `CHANGELOG.md` — full v3.5.0 entry
- `docs/VERSIONING.md` — versioning policy + lineage stamp + triplet sanity
- `docs/RELIABILITY.md` — failure modes + trigger layers + recovery
- `docs/VAULT-SAFETY.md` — vault-safety protocol + 7-layer recovery runbook
- `docs/PACKAGE-LIFECYCLE.md` — package lifecycle states + sync mechanism
- `docs/SKILL-PROMOTION.md` — skill + script promotion workflow
