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

**Stage A — Self-validation (2026-08-02):**
- `npm run validate:structure`: **pass** — 53 passed, 0 failed, 2 warnings
  (pre-existing: MASTERPROMPT.md coexists with MASTERPLAN.md; optional
  `ideas/` absent). Includes the new §8b lineage check: genesis_commit
  40-hex ✓.
- `npm run validate:schemas`: **pass** — 14 passed, 0 failed, 0 warnings.

**Stage B — Synthetic propagation (adapted vault-safe):**

The plan's Stage B bumped the real framework and rolled back with
`git reset --hard` — banned under vault safety. Adapted: *both* sides live
in `mktemp -d` — upstream = temp clone of org-os at pilot HEAD (branch
forced to `main`), instance = clone of that clone. Zero mutation of the
real repo.

- Instance customization (SOUL.md marker + upstream URL): commit `4d5a1a6`.
- Framework bump (README line): commit `0b67e38`.
- First run **refused: working tree dirty** — the untracked `node_modules`
  symlink. The real repo ignores `node_modules` via `.git/info/exclude`,
  which does not propagate to clones. Correct vault-safe behavior; fixed
  in the fixture by excluding locally. (Finding: fresh instances cloned
  from the framework lack the exclude — see postmortem.)
- Re-run `node scripts/sync-upstream.mjs --yes`: **exit 0**, all 10 stages.
  - Rebase: "Successfully rebased and updated refs/heads/main."
  - stage 6 migrate: no-op (0.5 == 0.5) ✓
  - stage 7 sync:packages: warned (`knowledge_base` enabled but not in
    framework) — correctly non-fatal ✓
  - stage 8 validators: both passed inside the instance ✓
  - stage 9/10: lineage updated, receipt `memory/sync-2026-08-02.md` ✓

**Closure evidence — all four conditions met:**
1. Pulled the framework bump: README.md tail = "upstream change for sync test" ✓
2. Preserved the customization: SOUL.md tail = `<!-- instance-only soul marker -->` ✓
3. `last_sync_commit: "0b67e38b56768a253ee52fa0128561e755bf4f14"` == upstream HEAD ✓
4. Receipt `memory/sync-2026-08-02.md` with upstream, old/new SHAs, counts ✓

Cosmetic defects observed (postmortem): the stale YAML comment
"# framework IS the upstream; null is correct here" survives beside the
now-set SHA (regex replace keeps trailing comments); "Commits applied: 203"
counted the whole upstream history on a first sync with `last_sync_commit:
null` — the true delta was 1 commit.

## What worked

(filled in Task 11)

## What broke / had to be invented

(filled in Task 11)

## Decisions for Phase 3 DECISIONS.md

(filled in Task 11)

## Migration note for downstream instances

(filled in Task 12)
