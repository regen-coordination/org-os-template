# Instance doctor

The instance doctor answers one question: is this instance healthy, and can it be updated from the framework safely? It has two verbs. `assess` is read-only: it runs six checks and prints a scorecard. `sync` repairs the machinery an instance needs to update itself, copies the framework's own files over, re-assesses, and writes a receipt. It stops at the first failure.

**Status:** pilot. `assess` has been run against the instances the maintainer operates, and the file-level overlay sync was accepted end to end against one of them (the acceptance report is not in this repository). The package's 167 tests pass offline. Every instance today is run by the maintainer, so nobody else has yet run `sync` against an instance they did not generate.

```bash
npm run doctor                                    # assess the current directory
npm run doctor -- --dir ../my-instance            # assess a sibling (hub mode)
npm run doctor -- sync --dir ../my-instance --dry-run   # print the plan, change nothing
npm run doctor -- sync --dir ../my-instance       # run it
```

The subcommand comes first (`doctor sync --dir …`); `assess` is the default when there is none.

## Hub mode: why `--dir` exists

An instance is supposed to update itself with `scripts/sync-upstream.mjs`. But if that script is missing, stubbed, or pointed at the wrong repository, the instance cannot repair its own updating mechanism with its own updating mechanism. So the doctor runs from the framework checkout against the instance, and brings the machinery with it. The checks and the validators it runs are the framework's copies, not the instance's, because the instance's copies are what may be broken.

- `--dir <path>` is the instance to operate on. Default: the current directory.
- `--framework <path>` is the framework checkout to compare against. Default: the checkout the doctor script lives in.
- Run from inside an instance, `npm run doctor` works only if the instance carries `scripts/doctor.mjs` and `packages/instance-doctor/`. Without the package the shim prints "instance-doctor is not present in this checkout", tells you to run from the framework with `--dir`, and exits 2.

## Assess

Flags: `--json` (machine-readable, for CI), `--strict` (warnings fail too; assess only), `--no-validators` (skip the two validator subprocesses for a quick read).

Exit codes: `0` no blockers · `1` blockers found (or, with `--strict`, any warning) · `2` bad usage.

This is real output (trimmed) against this framework repository itself (the framework is a running instance, so it assesses itself and says so; the lineage and `upstream` warnings are expected here and mean nothing for the framework):

```text
org-os instance doctor — org-os
  assessed against framework 0.5.0 — this IS the framework checkout

  ✓ Identity coherence       OK
  ⚠ Lineage                  WARN
      ⚠ [never-synced] metadata.last_sync_commit is null — this instance has never completed a framework sync
         → run `doctor sync` to perform the first sync and record the stamp
  ✓ Version surfaces         OK
  ⚠ Machinery integrity      WARN
      ⚠ [upstream-remote-missing] no `upstream` remote — the instance cannot fetch the framework
         → `doctor sync` adds it with the canonical URL
  ...
  0 blocker(s), 6 warning(s) across 6 checks
```

### What BLOCKER, WARN and OK mean

| Level | Meaning | Effect |
|---|---|---|
| **OK** | Nothing to report for that check. | none |
| **WARN** | Real drift, but the instance still works. | Exit code stays 0 unless `--strict`. |
| **BLOCKER** | The instance is broken or unsafe to sync. | Exit code 1. |

A check's level is the worst of its findings. Each finding has a code in square brackets and, usually, a hint after the arrow.

A blocker is not always a hand fix. Many hints say `doctor sync` repairs it. The ones that need you are a missing git remote, contradictory identity surfaces, and anything where the doctor would have to guess your intent.

### The six checks

Read them in this order: who am I, where did I come from, what version, does my machinery work, am I well-formed, am I alive.

| Check | Question |
|---|---|
| Identity coherence | Do `IDENTITY.md`, `federation.yaml` and `.well-known/dao.json` name the same organisation, and is the framework's own identity leaking into this instance? |
| Lineage | Do `federation.yaml` `metadata.genesis_commit` and `last_sync_commit` hold real commits, and how far has the framework moved since the last sync? |
| Version surfaces | Do `federation.yaml`, `VERSION.md` and `CHANGELOG.md` claim the same framework version, and is it behind the framework? |
| Machinery integrity | Do the scripts that `package.json` names exist, and are the git remotes right? |
| Structure + schemas | Do the framework's `validate-structure.mjs` and `validate-identity.mjs` pass against the instance? |
| Freshness | Is anyone working in it, and is it safe to sync now? |

Versions are compared by milestone, not by semver. org-os renumbered `3.5` to `0.5` once, on purpose (see [VERSIONING.md](VERSIONING.md)); an instance stamped `3.0` is behind a framework on `0.5`, not ahead.

### Common findings and what to do

Level and cause are from the check source in `packages/instance-doctor/src/checks/`.

| Code | Level | What it means | What to do |
|---|---|---|---|
| `template-leakage` | BLOCKER | The instance still carries the framework's own name (`org-os`, `organizational-os-template` and similar) in `package.json`, `IDENTITY.md`, `federation.yaml` or `dao.json`. It publishes the framework as itself. | Put your organisation's identity in, then `npm run generate:schemas`. Sync does not fix this. |
| `identity-name-disagreement` | BLOCKER | The surfaces name different organisations. | Pick the authoritative name, fix the others, regenerate schemas. The doctor never picks for you. |
| `git-remote-absent` | BLOCKER | The repository has no remote at all. | `git remote add origin <your-repo>` (sync adds `upstream`). Expected on a freshly generated instance; if it is the only blocker, the setup is fine. |
| `upstream-remote-wrong-url` | BLOCKER | `upstream` points somewhere other than `regen-coordination/org-os-template` (for example a pre-rename name or a divergent legacy repository). | `doctor sync` rewrites it. |
| `script-target-missing`, `script-is-noop-stub` | BLOCKER | A `package.json` script runs a file that is missing, or one that only prints and exits 0. | `doctor sync` installs the framework's copy, or delete the dead script entry. |
| `package-json-duplicate-key` | BLOCKER | A key appears twice in `package.json`; the last one silently wins. | Delete the redundant entry by hand. |
| `framework-version-missing`, `version-surfaces-contradict` | BLOCKER | No `metadata.framework_version`, or surfaces claim different milestones. | `doctor sync` re-stamps them in its migrate stage. |
| `genesis-commit-malformed`, `last-sync-commit-malformed` | BLOCKER | The stamp is not a 40-hex commit. | Replace `genesis_commit` with `git rev-list --max-parents=0 HEAD`; set `last_sync_commit` to `null` and let sync record it. |
| `federation-missing` | BLOCKER | No `federation.yaml`. | Not an org-os instance, or never scaffolded; sync cannot run. |
| `structure-invalid`, `schemas-invalid` | BLOCKER | A framework validator failed. | Run the named script by hand (`node scripts/validate-structure.mjs <dir>`) and fix what it lists. On a new instance, run `npm run generate:schemas` first. |
| `never-synced`, `sync-stale`, `unstamped-fork`, `lineage-absent` | WARN | The instance has no lineage stamp, never synced, or the framework has moved on since the stamped commit. | `doctor sync`. |
| `framework-version-stale` | WARN | The instance claims an older milestone than the framework. | `doctor sync`. |
| `upstream-remote-missing`, `upstream-declared-wrong-url` | WARN | No `upstream` remote, or `federation.yaml` declares a wrong upstream. | `doctor sync` adds the remote and corrects the declaration. |
| `machinery-skew` | WARN | A machinery script differs from the framework copy. Either an intentional local change or copy decay. | Decide; sync refreshes it from the framework. |
| `scaffold-placeholder`, `identity-md-missing`, `dao-json-missing`, `identity-type-disagreement` | WARN | Unfilled `TBD`/`[Your …]` placeholders; missing identity files; type mismatch. | Finish the bootstrap interview; `npm run generate:schemas`. |
| `working-tree-dirty` | WARN | Uncommitted changes. | Informational. Sync refuses only if a change collides with a file it would overwrite (below). |
| `repo-dormant`, `memory-absent`, `memory-stale`, `no-sync-receipts` | WARN | No commit for 90 days, no dated memory log, newest memory older than 60 days, no receipts. | Confirm the instance is live before syncing. |
| `validator-did-not-run` | WARN | A validator could not run (or `--no-validators`). | Run it by hand. |
| `package-json-missing` | BLOCKER | No `package.json`. | This directory is not an org-os instance; sync cannot fix it. |
| `not-a-git-repo` | BLOCKER | The directory is not a git repository. | `git init`, or point `--dir` at the right directory. |
| `version-scheme-unknown` | WARN | A version surface is on neither the legacy (1.x to 3.5) nor the 0.x line. | See the `[0.5.0]` re-baseline paragraph in `CHANGELOG.md`. |
| `structure-warnings`, `schemas-warnings` | WARN | The validator passed with warnings. | Run `node scripts/validate-structure.mjs <dir>` or `node scripts/validate-identity.mjs <dir>` to read them. |
| `migrations-dir-missing` | WARN | No `migrations/` at the instance root. | See the note below: this one does not clear. |

## Sync

Run the dry run first. It is read-only, so it is safe against a dirty production tree, and it prints exactly the nine stages with what each will do to this instance.

```bash
npm run doctor -- sync --dir ../my-instance --dry-run
npm run doctor -- sync --dir ../my-instance
```

### The nine stages, in order

If a stage fails, every later stage is skipped, nothing is re-stamped, and the receipt names the stage that stopped it. The exit code is 1.

1. **snapshot.** Writes `refs/snapshots/<timestamp>-doctor-sync`, a commit of the tracked and staged files made with `git stash create` (the `-u` it passes has no effect, so untracked files are not in it; see [Workspace safety](VAULT-SAFETY.md)). It does not touch the tree, the index or the stash list. Always first. Then the dirty-tree gate: if uncommitted changes collide with a file the overlay would write, it fails here and names them.
2. **ensure-upstream.** Adds the `upstream` remote, or rewrites it, to `https://github.com/regen-coordination/org-os-template.git`. Also corrects `federation.yaml` `upstream[0].url`, and commits that change on its own.
3. **fetch.** `git fetch upstream`. Needs network access to the framework repository.
4. **inject-machinery.** Copies `scripts/sync-upstream.mjs`, `scripts/validate-identity.mjs`, `scripts/validate-structure.mjs` and `scripts/doctor.mjs` from the framework, and commits them (explicit paths, never `git add -A`). This is the step that breaks the deadlock.
5. **overlay.** Copies the framework-owned paths, `scripts/` and `templates/`, over the instance's, and commits them. It only adds and updates; it never deletes. It refuses to write `data/`, `memory/`, `.well-known/`, `knowledge/`, `repos/`, `federation.yaml`, `package.json` or the identity files (`IDENTITY.md`, `SOUL.md`, `MASTERPLAN.md` and the rest).
6. **migrate.** `npm run migrate --if-present` in the instance, then re-stamps the version surfaces that claim a framework version (`federation.yaml`, `VERSION.md`, and `package.json` only if it is still named after the template).
7. **generate-schemas.** `npm run generate:schemas --if-present`, republishing `.well-known/`.
8. **re-assess.** The six checks again. Any blocker fails the sync.
9. **receipt.** Writes `memory/reports/sync-receipt-<date>.md` and stamps `federation.yaml`: `last_sync_commit` to the framework's HEAD, `genesis_commit` (only if absent) to the instance's root commit, and `last_updated`.

### What it will not touch, and what it leaves behind

- **Uncommitted work is safe unless it collides.** Only dirty files that the overlay would overwrite stop the run. Uncommitted `data/`, `memory/`, drafts and your own scripts do not. The doctor's own earlier output (injected machinery, an old receipt) does not count as dirt either, so it can retry after its own abort.
- **Stages 6 to 9 are not committed.** After a run, `git status` in the instance shows the re-stamp, the regenerated `.well-known/`, the stamped `federation.yaml` and the receipt as uncommitted. Review and commit them yourself. Stages 2, 4 and 5 are committed, each separately, so each can be reverted alone.
- **Undo.** The snapshot ref from stage 1 is a local commit of the tracked files as they were before the run. Untracked files are not in it. List them with `git for-each-ref refs/snapshots`.
- **It does not edit your `package.json`.** The overlay copies every file under `scripts/` and `templates/`, including scripts the clone had left out, but it does not add `package.json` entries for them. Those scripts exist but have no `npm run` name.
- **Receipts are one per day.** A second run on the same date overwrites the first receipt, including an aborted run overwriting a successful one. Read the receipt before you re-run.

### Verify

A sync reports success only when its own re-assessment has no blockers. Check independently:

```bash
npm run doctor -- --dir ../my-instance
cat ../my-instance/memory/reports/sync-receipt-*.md
```

Real run, against a scratch instance generated with `npm run clone:framework` (see [Setup](SETUP.md)): before sync, 2 blockers and 5 warnings (`git-remote-absent`, `structure-invalid` because schemas were not yet generated, and the lineage and freshness warnings). After sync, 0 blockers and 4 warnings: lineage and the receipt warning cleared, and the `upstream` remote counted as the missing remote. The overlay added 29 files.

## Known problems

Found while writing this page; they are code issues, not documentation issues.

- `migrations-dir-missing` never clears after a sync. The check looks for `migrations/` at the instance root, but the migrate script reads `scripts/migrations/`, and no stage creates the root directory, although the hint says sync does. Treat this warning as noise until the check is fixed.
- The `structure-invalid` blocker on a freshly generated instance is cleared by `npm run generate:schemas`, not by sync alone.

## Files it reads and writes

Reads: `federation.yaml`, `IDENTITY.md`, `.well-known/dao.json`, `package.json`, `VERSION.md`, `CHANGELOG.md`, the sync scripts, git remotes and log, `memory/`. Assess writes nothing. Sync writes the files above and the receipt.

For how the package is built (pure checks over one snapshot, every side effect injected) see its [README](../packages/instance-doctor/README.md). The step-by-step operator skill is [skills/instance-doctor/SKILL.md](../skills/instance-doctor/SKILL.md). Related: [Adopt with an AI agent](ADOPT-WITH-AN-AGENT.md), [Versioning](VERSIONING.md).
