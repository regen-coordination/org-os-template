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
prints the nine stages with exactly what each will do to this instance.

> **Status:** the full sync works. Stage 5 used to delegate to a
> `git pull --rebase upstream main` that assumes the instance is a *fork* —
> every real instance is a *scaffold* with its own root commit, so it stranded
> the repo mid-rebase (it did exactly that to refi-med-os on 2026-08-28, which
> is why v0.5.0 shipped with the claim narrowed). Since v0.5.1 stage 5 is a
> **file-level overlay**: framework-owned paths copied in, everything the org
> owns left alone, the lineage stamp recording which framework commit was
> applied. Accepted end to end against refi-med-os with all nine stages green
> (`memory/reports/overlay-acceptance-2026-08-29.md`). Re-running is a clean
> no-op.

Then run it:

```bash
npm run doctor -- sync --dir ../refi-med-os
```

The nine stages:

1. **snapshot** — a recoverable ref of the whole working tree, always written
   first, even if the run aborts a moment later.
2. **ensure-upstream** — add the `upstream` remote, or rewrite it when it points
   somewhere divergent.
3. **fetch** — fetch the framework.
4. **inject-machinery** — copy the framework's sync scripts into the instance.
   This is the step that breaks the deadlock.
5. **overlay** — copy the framework-owned paths (scripts/, templates/) over the
   instance's. Never touches data/, memory/, identity files or .well-known/.
6. **migrate** — framework migrations, plus the cross-scheme version re-stamp.
7. **generate-schemas** — republish `.well-known/`.
8. **re-assess** — the full battery again.
9. **receipt** — `memory/reports/sync-receipt-<date>.md` and the lineage stamp.

**If a stage fails, everything after it is skipped.** Nothing is re-stamped and
the receipt names the stage that stopped it. A half-migrated instance is worse
than an unsynced one, because it looks synced.

A dirty working tree aborts at stage 1 — the snapshot is still written, but the
sync refuses to continue. Commit or discard, then re-run.

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
- **It will not sync a dirty tree.** Nor will it stash, discard, or hard-reset
  anything to make one clean.
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
