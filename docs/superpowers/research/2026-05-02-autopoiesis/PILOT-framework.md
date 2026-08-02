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

(filled in Tasks 2–9)

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
