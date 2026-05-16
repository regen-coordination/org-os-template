# RELIABILITY — Failure Modes, Trigger Layers, Recovery

This is the reliability contract of org-os. Every failure mode the framework promises to catch must be enforced by ≥1 trigger layer.

## Failure modes

1. **Data integrity** — schema or structure violations in `data/*.yaml`, `federation.yaml`, `dashboard.yaml`, `.well-known/*.json`
2. **Agent runtime correctness** — `/initialize`, `/close`, scripts produce broken or stub output
3. **Federation drift** — instance frameworks fall out of sync with framework version (or with each other)
4. **Script divergence** — instance scripts drift silently from framework canonical (introduced v3.5)
5. **Recovery** — corruption, failed sync, broken migration, lost untracked content

## Trigger layers

| Layer | When | Checks |
|---|---|---|
| **Manual** | Operator on demand | `npm run selftest` (validators + clone-engine dry-run if available) |
| **Pre-commit** | Local commit | `validate:structure` always; `validate:schemas` if `data/*.yaml` touched; `vault:audit` advisory |
| **CI** | Push, PR | Full validator suite + selftest + check-divergence (advisory) |
| **Scheduled** | Weekly Sun 04:00 UTC | `analyze:instances`, commits drift report to `memory/reports/` |
| **Pre-destructive** | Any risky git op | `vault:snapshot` (operator-invoked per VAULT-SAFETY.md) |

## Federation SLA

- **Healthy:** `last_sync` ≤ 30 days, structure validates, framework_version matches semver minor
- **Drifted:** `last_sync` 30–90 days or framework_version one minor behind
- **Dormant:** `last_sync` > 90 days or framework_version two+ minor behind

`npm run analyze:instances` produces drift report; `memory/reports/instances-drift-YYYY-MM-DD.md` is the artifact.

## Script divergence (v3.5 addition)

`npm run check:divergence` compares each instance's `scripts/<name>.mjs` against framework canonical via md5. Output is purely advisory — never modifies files.

- **IDENTICAL** — instance on canonical version
- **DIVERGES** — local variant (intentional override, drift, or known divergence per `docs/SKILL-PROMOTION.md`)
- **MISSING** — script not present in that instance (instance hasn't opted into the canonical pipeline)

Divergences are resolved manually by the operator during cascade. Do not build three-way merge tooling.

## Recovery runbook

### Data corruption

1. `npm run validate:schemas` flags the file
2. `git log -- data/<file>.yaml` finds last good version
3. `git checkout <sha> -- data/<file>.yaml`
4. Re-run validators to confirm

### Failed sync (sync-upstream or sync-packages)

- Engines are non-destructive; failures leave inspectable state
- Inspect what was partially written; fix root cause; re-run
- If lineage stamp corrupted, restore from `git log -p federation.yaml`

### Broken migration

- All migrations are idempotent + additive (no deletes); re-running is safe
- `memory/migrations-YYYY-MM-DD.md` logs what each migration did
- Roll back by reverting the commit, then re-author migration

### Lost untracked content

- See `docs/VAULT-SAFETY.md` 7-layer recovery runbook (snapshot refs → stash trees → Syncthing → dangling blobs → reflog → agent worktrees → OS backups)

### Lost work (detached HEAD)

- `git reflog --date=iso` lists every HEAD position with timestamp
- `git branch recover-<reason> <sha>` to anchor before checking out

## Self-test surface

`npm run selftest` runs:

1. `validate:structure` — full structural pass (must exit 0)
2. `validate:schemas` — EIP-4824 schema validation (must exit 0)
3. `analyze:instances` — produces report; failure if any instance shows critical drift
4. *(if installed)* `clone:framework --dry --target /tmp/selftest-clone --config tests/fixtures/instance-config.yaml` — exercises clone engine end-to-end without writing
5. *(if installed)* `node --test tests/` — all node:test suites green

Exit code 0 = green; 1 = failures; 2 = warnings only.

## CI failure handling

- Pre-commit failures are bypassable with `--no-verify` ONLY if the user explicitly authorizes
- CI failures block merge; fix root cause, don't disable check
- Scheduled drift reports auto-commit; investigate any drift report with >5 items

## Version triplet sanity

`npm run version:check` (new v3.5) confirms agreement across:
- `package.json` `version`
- `federation.yaml.metadata.framework_version` (major.minor only)
- `CHANGELOG.md` most recent `[X.Y.Z]` section header

Any mismatch is a release-discipline failure caught before tag.
