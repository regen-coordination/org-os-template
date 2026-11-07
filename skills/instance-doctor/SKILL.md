---
name: instance-doctor
version: 1.0.0
description: Assess any org-os instance for identity, lineage, version, machinery, structure and freshness defects, then sync it from the framework — the guided assess → read scorecard → sync → verify flow. Assess is proven across the live fleet; the file-level overlay sync is accepted end to end against a real instance
author: organizational-os
category: infrastructure
metadata:
  openclaw:
    requires:
      env: []
      bins: ["git", "node"]
      config: []
---

# Instance Doctor

## What This Is

Two verbs over any org-os instance:

- **`assess`** — read-only. Runs six checks and prints a scorecard of
  `BLOCKER` / `WARN` / `OK`, each finding carrying a remediation hint. Proven
  against all six real instances plus the framework itself (2026-08-28
  acceptance run).
- **`sync`** — snapshots the instance, repairs the machinery it needs in order
  to update itself, overlays the framework's own files, migrates, re-assesses,
  and writes a dated receipt. Aborts on the first failure, so an instance is
  never left half-migrated.

It exists because of a specific deadlock. Downstream instances are supposed to
update themselves by running `scripts/sync-upstream.mjs`. As of the 2026-08-28
sweep, **not one instance could**: the script was missing in three, a 178-byte
no-op in a fourth, and pointed at a divergent legacy repository in a fifth. An
instance cannot repair its own updating mechanism using its own updating
mechanism. So the doctor runs **from the framework, against the instance**, and
supplies the machinery.

## When to Use

- Before trusting anything an instance reports — `assess` first.
- Before and after any framework sync.
- When onboarding an instance you did not bootstrap yourself.
- When an instance "passes all validators" but behaves oddly. That combination
  is the signature this skill was built for: the existing validators accept an
  instance publishing the *framework's* identity as its own.

## The Operator Flow

### 1. Assess

From the framework, against a sibling (**hub mode** — the usual case):

```bash
npm run doctor -- --dir ../refi-med-os
```

From inside an instance that already carries the machinery:

```bash
npm run doctor
```

Useful flags: `--json` (machine-readable, for CI), `--strict` (warnings fail
too), `--no-validators` (skip the two validator subprocesses when you want a
fast read).

In an instance, `npm run validate:schemas` scans `.well-known/` for leaks but
cannot check the standards schemas (the vendored generator has no ajv), so
`--strict` cannot pass there by design. For the strict check, run the
framework's validator against the instance:
`node <framework>/scripts/validate-identity.mjs <this instance> --strict`.

Exit codes: `0` no blockers · `1` blockers found · `2` bad usage.

### 2. Read the scorecard

Six checks, in the order an operator should think about them:

| Check | Question it answers |
|---|---|
| **Identity coherence** | Who does this instance say it is — and does every surface agree? |
| **Lineage** | Where did it come from, and when did it last sync? |
| **Version surfaces** | Which framework version does it claim, on every surface that claims one? |
| **Machinery integrity** | Do its scripts, remotes and migrations actually work? |
| **Structure + schemas** | Is it well-formed by the framework's own validators? |
| **Freshness** | Is anyone actually running it, and is it safe to sync right now? |

Two things worth knowing when reading the output:

- **A blocker is not always a hand-fix.** Most carry a hint saying `doctor sync`
  repairs it. The ones that need you are missing remotes, contradictory
  identities, and anything where the doctor would have to guess your intent.
- **Version numbers are compared by milestone, not by semver.** org-os
  re-baselined `3.5 → 0.5` once, deliberately. An instance stamped `3.0` is
  *behind* a framework on `0.5`, not ahead. The map's source of truth is the
  `[0.5.0]` re-baseline paragraph in `CHANGELOG.md`.

### 3. Sync

Always look at the plan first:

```bash
npm run doctor -- sync --dir ../refi-med-os --dry-run
```

`--dry-run` is genuinely read-only — safe against dirty production trees. It
prints the ten stages with exactly what each will do to this instance.

> **Status:** the full sync works. Stage 5 used to delegate to a
> `git pull --rebase upstream main` that assumes the instance is a *fork* —
> every real instance is a *scaffold* with its own root commit, so it stranded
> the repo mid-rebase (it did exactly that to refi-med-os on 2026-08-28, which
> is why v0.5.0 shipped with the claim narrowed). Since v0.5.1 stage 5 is a
> **file-level overlay**: framework-owned paths copied in, everything the org
> owns left alone, the lineage stamp recording which framework commit was
> applied. Accepted end to end against a production instance with all stages green (nine at the time; `declare-visibility` came after)
> (`memory/reports/overlay-acceptance-2026-08-29.md`). Re-running is a clean
> no-op.

Then run it:

```bash
npm run doctor -- sync --dir ../refi-med-os
```

An instance with a `.sync-freeze` file at its root is refused before stage 1:
no snapshot, no commit, no receipt, exit 1, and the file's text is printed as
the reason. `sync-upstream.mjs` refuses the same file. `--dry-run` says the
instance is frozen. Remove the file to sync it.

The ten stages:

1. **snapshot** — a recoverable ref of the whole working tree, always written
   first, even if the run aborts a moment later.
2. **ensure-upstream** — add the `upstream` remote, or rewrite it when it points
   somewhere divergent.
3. **fetch** — fetch the framework.
4. **inject-machinery** — copy the framework's sync scripts into the instance.
   This is the step that breaks the deadlock.
5. **overlay** — copy the framework-owned paths (scripts/, templates/) over the
   instance's. Never touches data/, memory/, identity files or .well-known/.
6. **migrate** — the framework's runner against the instance
   (`node <framework>/scripts/migrate.mjs <instance> --target <framework version>`),
   then the cross-scheme version re-stamp.
7. **declare-visibility** — DAO-OS L8 publishes only what `data/visibility.yaml`
   declares public, and its default is `members`. When the instance has no such
   file, this stage writes one that declares public only what the instance's
   `.well-known/` shows it publishes today (R31): `members.json` → members (ids
   public, every other member field `members`), `proposals.json` → governance
   (its description and rules `members`: 0.6 published decision rows only),
   `contracts.json` → systems, `meetings.json`, `projects.json`, `finances.json`,
   `ideas.json` → their collections, `knowledge.json` → knowledge-manifest and
   sources — each only when the instance has the registry (`data/<name>.yaml`,
   or `content/<name>/*.md` for meetings and projects). It is its own commit
   `chore(visibility): declare what this instance already publishes`, a
   publication decision for the org: confirm it, edit it, or revert that commit
   to publish less. `--dry-run` prints the file; the receipt repeats it under
   "Publication decision for the org". Left alone: an instance that already has
   the file, one whose `data/visibility.yaml` has any git history (so a revert
   stays reverted), one with no 0.6 output (a clone's lone `dao.json` is
   not one), and one whose `.well-known/dao.json` carries the L8 generator's
   mark (`"x-org-os": { "generator": … }`, L8-C18): its `members.json`,
   `proposals.json` … were written by L8, even empty, and show nothing 0.6
   published.
8. **generate-schemas** — republish `.well-known/`.
9. **re-assess** — the full battery again.
10. **receipt** — `memory/reports/sync-receipt-<date>.md` and the lineage stamp.

**If a stage fails, everything after it is skipped.** Nothing is re-stamped and
the receipt names the stage that stopped it. A half-migrated instance is worse
than an unsynced one, because it looks synced.

Uncommitted work aborts at stage 1 **only when it collides with a file this run
would overwrite** — the intersection of your dirty paths with the overlay's
`add`+`update` set. The snapshot is still written, and the refusal names the
exact colliding files. Commit or revert those, then re-run.

Everything else stays put: the overlay only writes framework-owned paths and
never deletes, so uncommitted `data/`, `memory/`, drafts, generated output and
your own scripts are out of scope by construction and do not block. (Before
v0.5.1 the gate refused on any dirty file at all — correct when stage 5 was a
rebase that rewrote the whole tree, far too coarse for a file-level overlay.)

### 4. Verify

The sync only reports success when its own re-assessment comes back with zero
blockers. To confirm independently:

```bash
npm run doctor -- --dir ../refi-med-os
cat ../refi-med-os/memory/reports/sync-receipt-*.md
```

## What This Skill Will Not Do

- **It will not guess your identity.** A name disagreement is reported, never
  resolved — picking the "right" name is an organizational decision.
- **It will not overwrite uncommitted work.** It refuses when a dirty file is
  one it would write, and it will never stash, discard, or hard-reset anything
  to clear the way.
- **It will not sync a frozen instance.** A `.sync-freeze` file at the root
  is the instance's own pin; the doctor stops before writing anything.
- **It will not touch an instance's own `package.json` version.** That is the
  instance's version, not a framework claim. The only exception is a
  `package.json` still named after the template, which means the file was
  inherited wholesale.

## Reference

- Package: `packages/instance-doctor/`
- Entry point: `npm run doctor` → `scripts/doctor.mjs`
- Module manifest: `modules/org-os-instance-doctor/module.yaml`
- Related: `scripts/sync-upstream.mjs` (the sync this wraps),
  `scripts/validate-structure.mjs` and `scripts/validate-identity.mjs` (the
  validators check B5 runs), `scripts/analyze-instances.mjs` (fleet-wide drift,
  where this is per-instance depth)
