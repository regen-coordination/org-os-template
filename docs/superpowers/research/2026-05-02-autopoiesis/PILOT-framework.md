# Autopoiesis Phase 2 Pilot — Cascade Closure (Loop C)

> Branch: `autopoiesis-phase2-pilot` (off `feat/multica-operator`)
> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Synthesis: [`SYNTHESIS.md`](SYNTHESIS.md)
> Loop: Loop C — Population learning (Metabolism → Cognition → Federation)
> Status: in progress

## Context note (2026-08-02)

The three closing-edge artifacts were implemented ahead of this pilot in commit
`ec09cdc` (2026-05-16, "feat(autopoiesis): sync-upstream + validate-identity +
lineage stamp (Phase 2)") — with a richer design than the plan spec'd. This
pilot session backfills what that commit did not deliver: the TDD test harness,
validate-structure §8b, FEDERATION.md lineage docs, the end-to-end exercise,
and this postmortem. Where the implementation diverges from the plan, the
implementation's behavior is treated as authoritative and tests are written
against it; divergences are logged in "What broke / had to be invented".

## Closing edge (per SYNTHESIS.md)

Three artifacts implementing cascade closure:
1. `scripts/sync-upstream.mjs` — propagation script honoring customizations
2. `scripts/validate-identity.mjs` — phantom validator (resolves `npm run validate:schemas`)
3. Lineage stamp in `federation.yaml.metadata` (`genesis_commit` + `last_sync_commit`)

## Artifacts implemented

Pre-existing (commit `ec09cdc`, 2026-05-16):

- `scripts/validate-identity.mjs` — phantom validator made real; resolves
  `npm run validate:schemas`. Richer than planned: also validates
  `.well-known/*.json`, supports `--strict`, warns (not fails) on missing
  `genesis_commit`.
- `scripts/sync-upstream.mjs` — phantom propagation script made real;
  resolves `npm run sync:upstream`. 10-stage flow with vault-safety +
  `.sync-freeze` guards, rebase-based sync, confirmation gate.
- `federation.yaml` — `metadata.genesis_commit` populated
  (`af8941a2…`), `last_sync_commit: null` (framework IS the upstream).

Backfilled in this pilot (branch `autopoiesis-phase2-pilot`):

- `tests/scripts/validate-identity.test.mjs` — 7 characterization cases
  (7/7 pass): agreement, name mismatch, missing genesis warn + `--strict`
  promotion, malformed SHAs, framework_version shape.
- `tests/scripts/sync-upstream.test.mjs` — 10 cases (10/10 pass) against
  real temp git repos: happy path, preview gate, customization
  preservation, lineage update, receipt, no-op, genesis seeding,
  `memory/` creation, dirty-tree refusal, freeze refusal.
- `scripts/sync-upstream.mjs` fixes (TDD, caught by the new tests):
  1. **stage-5 null crash** — `git()` `.trim()`'d the null return of
     `execSync(..., {stdio:'inherit'})`, so every successful pull was
     reported as a failure; as shipped the script could never complete
     a sync. Null guard added.
  2. **genesis seeding** — stage 9 now seeds `genesis_commit` from the
     instance root commit on first sync (validate-identity's warning had
     promised this, but nothing implemented it).
  3. **`memory/` mkdir** — stage 10 no longer crashes on instances
     without a `memory/` directory.
- `scripts/validate-identity.mjs` — exit-code docstring corrected
  (warnings exit 0 by design, not 2; sync-upstream stage 8 depends on it).
- `scripts/validate-structure.mjs` — §8b Lineage Stamp: `genesis_commit`
  40-hex shape when present, warn when absent (no first-sync deadlock);
  `last_sync_commit` shape when non-null.
- `docs/FEDERATION.md` — lineage stamp documented in the `metadata`
  section (fields, semantics, use cases).
- `docs/VERSIONING.md` — pull-based migration recipe marked functional,
  with sync-receipt + seeding behavior noted.

## Exercise — what we ran, what happened

(filled in Task 10)

## What worked

(filled in Task 11)

## What broke / had to be invented

(filled in Task 11)

## Decisions for Phase 3 DECISIONS.md

(filled in Task 11)

## Migration note for downstream instances

(filled in Task 12)
