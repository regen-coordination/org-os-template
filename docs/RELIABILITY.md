# Reliability

This page lists what can go wrong in an org-os instance and which check, if any, catches it. Each check below is a script or a workflow in this repository; where a failure mode has no check, the page says so.

## Failure modes

1. **Data integrity** — missing or malformed required files, `federation.yaml` sections, `.well-known/*.json`, and identity files that disagree with `federation.yaml`. Since 0.6, `validate:data` checks each `data/*.yaml` registry the admin knows against its JSON Schema, and `validate:governance` checks the rules and the git history against them (see [Data model](DATA-MODEL.md)); both need `packages/admin`'s dependencies and run from the framework. Nothing validates `dashboard.yaml`.
2. **Agent runtime correctness** — `/initialize`, `/close` and the scripts they call produce broken or stub output. Only the unit tests under `tests/` cover this; there is no runtime monitor.
3. **Federation drift** — an instance falls out of line with the framework (skills, packages, data registries, `framework_version`).
4. **Script divergence** — instance scripts drift silently from the framework's.
5. **Recovery** — corruption, failed sync, broken migration, lost untracked content.

## Trigger layers

| Layer | When | Checks |
|---|---|---|
| **Manual** | Operator on demand | `npm run selftest` (see below) |
| **Pre-commit** | Local commit, after `npm run install:hooks` | `validate:structure` always; `validate:schemas` if a `data/*.yaml` file is staged, and then `validate:data` and `validate:governance` as warnings only (never blocking), where their scripts exist. In a linked worktree with no `node_modules` it skips every check and says so. `vault:audit` is not part of it. |
| **Pre-push** | Local push, same installer | Refuses to push `agent/*` branches |
| **CI** | Push to `main` or `release/**`; pull request to `main` | `.github/workflows/validate.yml` (30-minute limit, full-depth checkout): `validate:structure`, `validate:schemas`, `validate:data`, `validate:governance` (with `CI=true` a commit that went around the rules is an error), `analyze:instances`, `npm test`, `selftest` (which includes `check:divergence`), `test:admin`, the site build and tests, a docs drift report that never blocks and is written to the run summary, and `version:check` |
| **Scheduled** | Weekly, Sunday 04:00 UTC | `.github/workflows/drift.yml`: `analyze:instances`, then commits any new report in `memory/reports/` |
| **Pre-destructive** | Before a risky git operation | `vault:snapshot` (tracked files only; protect untracked notes first), run by the operator (see [VAULT-SAFETY.md](VAULT-SAFETY.md)); `vault:audit` afterwards |

`npm run install:hooks` installs `.github/hooks/pre-commit.sh` and `scripts/git-hooks/pre-push` into the live hooks directory, once per clone; it does not overwrite a hook whose content differs unless run with `--force`. `scripts/operator-setup.sh` sets `core.hooksPath` to `scripts/hooks`; `install:hooks` resolves the hooks directory through git, so on a clone set up that way it targets `scripts/hooks/`, finds the main-blocking `pre-commit` there (different content) and refuses without `--force`. A separate hook, `scripts/hooks/pre-commit`, blocks commits to `main` for multi-operator clones; `scripts/operator-setup.sh` installs it. Another workflow, `generate-schemas.yml`, regenerates `.well-known/` daily.

## Federation drift

`npm run analyze:instances` reads `data/instances.yaml` (present only in the framework repository) and inspects each instance cloned locally. It lists, per instance, drift items such as `not_cloned_locally`, `local_path_missing`, `missing_masterplan`, `missing_federation_yaml`, `framework_version_mismatch`, `undeclared_skill`, `unmapped_skill`, `unmapped_package` and `undeclared_data_registry`. It writes `memory/reports/instances-drift-YYYY-MM-DD.md` and always exits 0: drift is informational, so the weekly job and the CI step cannot fail on it. `--json` prints the report instead of writing it.

There are no age thresholds. Nothing computes healthy, drifted or dormant from `last_sync` or from how many minors an instance is behind.

## Script divergence

`npm run check:divergence` compares each of the framework's `scripts/*.mjs` and `*.js` files with the same-named file in each instance, by md5. Instances come from `data/instances.yaml` (sibling directories that have a `scripts/` folder) or from `--instances "path1,path2"`; `--script <name>` limits it to one script. It prints a result and never modifies files; with no instances found it says so and exits 0.

- **IDENTICAL** — instance on canonical version
- **DIVERGES** — local variant (intentional override, drift, or known divergence per [`docs/SKILL-PROMOTION.md`](SKILL-PROMOTION.md))
- **MISSING** — script not present in that instance (instance hasn't opted into the canonical pipeline)

The operator resolves divergences by hand. There is no merge tooling.

## Recovery runbook

### Data corruption

1. `npm run validate:data` flags a registry that breaks its schema; `npm run validate:schemas` flags `.well-known/` and identity problems
2. `git log -- data/<file>.yaml` finds last good version
3. `git checkout <sha> -- data/<file>.yaml`
4. Re-run validators to confirm

### Failed sync (`sync:upstream` or `sync:packages`)

- `sync:upstream` refuses to run on a dirty working tree, and refuses (exit 2) when a `.sync-freeze` file is present. It fetches and rebases onto the framework's `main`, then runs the migrations, `sync:packages` and the two validators. A failure leaves the git state (a rebase in progress, partly written files) for you to inspect.
- `sync:packages` copies enabled packages and warns about disabled ones; it deletes them only with `--prune`. `--dry` writes nothing.
- Fix the root cause and re-run. If the lineage stamp in `federation.yaml` is corrupted, restore it from `git log -p federation.yaml`.

### Broken migration

- `npm run migrate` runs the scripts in `scripts/migrations/` from the instance's `framework_version` up to `package.json`'s version or `--target <version>` (`--dry` lists them). On the 0.x line that means the two `v0.5-to-v0.6-…` migrations; the two with legacy numbers never run on a 0.x instance. See [Versioning](VERSIONING.md). Each is written to be idempotent, so re-running should be safe
- The v3 to v3.5 migration and both 0.6 migrations log to `memory/migrations-YYYY-MM-DD.md`; the v2 to v3 migration does not
- Roll back by reverting the commit, then fix the migration

### Lost untracked content

- See the seven-layer recovery runbook in [VAULT-SAFETY.md](VAULT-SAFETY.md) (snapshot refs → stash trees → Syncthing → dangling blobs → reflog → agent worktrees → OS backups)

### Lost work (detached HEAD)

- `git reflog --date=iso` lists every HEAD position with timestamp
- `git branch recover-<reason> <sha>` to anchor before checking out

## Self-test surface

`npm run selftest` (`scripts/selftest.mjs`) runs these checks in order:

1. `validate:structure` — must pass.
2. `validate:schemas` — `.well-known/*.json` structure (and, with a `daoURI`, the standards schemas and leak scan), `IDENTITY.md` against `federation.yaml`, the `framework_version` and lineage stamp shape. Skipped if its script is missing.
3. `validate:data` and `validate:governance` — skipped, with the install command, when `packages/admin` has no `node_modules`; skipped as optional where the script is absent (an instance).
4. `analyze:instances` — framework repository only (skipped where `data/instances.yaml` is absent). Writes the drift report; it cannot fail on drift.
5. `check:divergence` — advisory; skippable with `--skip divergence`.
6. Berd skills mirror in sync (`sync-skills-berd.mjs --check`) — framework repository only.
7. `clone:framework --dry` against `tests/fixtures/instance-config.yaml`, into a temporary directory — skipped if the script is missing.
8. `node --test tests/**/*.test.mjs`.
9. `test:admin` — skipped, with the install command, if `packages/admin` or its dependencies are absent.

A check whose script does not exist, or that does not apply to an instance, is reported as skipped rather than failed. `--verbose` shows each check's output; `--skip a,b` skips by key (`divergence`, `berd`, `clone`, `tests`, `admin`).

A failed check reports the names of the failing tests when its output has them (vitest and `node --test`; `scripts/lib/test-failures.mjs`), else its last lines. Exit code 0: all green. 1: at least one failure. 2: warnings only.

## CI failure handling

- Pre-commit failures are bypassable with `git commit --no-verify`; do it only with the operator's explicit say-so
- Fix the root cause of a CI failure rather than disabling the check (whether a failure blocks merge depends on the repository's branch protection, which is not in the repo)
- The scheduled job commits each new drift report by itself; read them, since nothing else surfaces drift

## Version triplet sanity

`npm run version:check` (`scripts/update-version.mjs --check`) confirms that these agree on major.minor:
- `package.json` `version`
- `federation.yaml` `metadata.framework_version`
- the most recent `[X.Y.Z]` heading in `CHANGELOG.md`
- the `**Framework Version:**` line in `VERSION.md`, if present
- the `**Version:**` header in `MASTERPLAN.md`, if present

It exits 1 with a diff on a mismatch and changes no file. CI runs it. `validate:structure` also compares `package.json` with `framework_version` (except on a `0.x` instance version) and warns when `CHANGELOG.md` has no heading for the current version.
