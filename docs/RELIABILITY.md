# RELIABILITY — Failure Modes, Trigger Layers, Recovery

This is the reliability contract of org-os. Every failure mode the framework
promises to catch must be enforced by ≥1 trigger layer.

## Failure modes

1. **Data integrity** — schema or structure violations in `data/*.yaml`, `federation.yaml`, `dashboard.yaml`
2. **Agent runtime correctness** — `/initialize`, `/close`, scripts produce broken or stub output
3. **Federation drift** — instance frameworks fall out of sync with framework version
4. **Recovery** — corruption, failed sync, broken migration

## Trigger layers

| Layer | When | Checks |
|---|---|---|
| Pre-commit | Local commit | `validate:structure` always; `validate:schemas` if `data/*.yaml` touched |
| CI | Push, PR | Full validator suite + `selftest` (incl. clone-engine dry-run) |
| Scheduled | Weekly Sun 04:00 UTC | `analyze:instances`, commits drift report |
| Manual | Operator on demand | `npm run selftest` |

## Federation SLA

- **Drifted:** `last_sync` > 30 days
- **Dormant:** `last_sync` > 90 days

## Recovery runbook

### Data corruption
1. `npm run validate:schemas` flags the file
2. `git log -- data/<file>.yaml` finds last good version
3. `git checkout <sha> -- data/<file>.yaml`
4. Re-run validators to confirm

### Failed sync (sync-upstream or sync-packages)
- Engines are non-destructive; failures leave inspectable state
- Inspect what was partially written; fix root cause; re-run

### Broken migration
- `npm run migrate -- --rollback` reverts the last applied migration
- Investigate failure cause before re-applying

### Lost work (detached HEAD)
- `git reflog` shows recent commits
- Create branch from desired commit: `git branch <name> <sha>`

## Self-test surface

`npm run selftest` is the agent runtime smoke test (separate from `/initialize`).
- `/initialize` stays fast (< 5s) and tolerant
- `selftest` allowed to be slow (up to 60s); exits non-zero on any failure mode
