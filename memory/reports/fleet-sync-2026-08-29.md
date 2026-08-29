# Fleet sync — plan-aware dirty gate + four instances (H8)

**Date:** 2026-08-29
**Brief:** [`docs/superpowers/plans/2026-08-29-v0.5.1-fleet-sync-handoff.md`](../../docs/superpowers/plans/2026-08-29-v0.5.1-fleet-sync-handoff.md)
**Follows:** [`overlay-acceptance-2026-08-29.md`](overlay-acceptance-2026-08-29.md) (the overlay itself, accepted against refi-med-os)
**Framework at sync time:** `e70a9b8` (v0.5.1 dev)

---

## A. The gate change

`doctor sync` refused on *any* uncommitted file. That was correct when stage 5
was `git pull --rebase`, which rewrites the whole working tree. The v0.5.1
overlay writes a computed, narrow list, so the gate now asks the honest
question: **does any uncommitted change intersect what this run will write?**

Implementation: `buildOverlayPlan()` extracted from the overlay stage so the
snapshot gate and the writer answer with the same code; `plannedWritePaths()`
takes `add` + `update` (not `unchanged`); `collidingDirtyEntries()` intersects.
When no plan can be computed the gate falls back to refusing any dirty tree —
a gate that cannot see what it writes must refuse.

**Measured before touching anything** (read-only probe, all six instances):

| Instance | Dirty (foreign) | Overlay would write | Collisions |
|---|---:|---:|---:|
| bread-coop-os | 9 | 37 | **0** |
| regen-coordination-os | 24 | 47 | **0** |
| dao-os | 7 | 57 | **1** |
| regen-toolkit | 3,005 | 51 | **0** |
| refi-bcn-os | 34 | 48 | **0** |
| refi-dao-os | 177 | 51 | **0** |

3,256 uncommitted files across the fleet; **one** genuine collision. This
reproduces the handoff's independent 2026-08-29 measurement exactly.

Tests pin both directions (`tests/instance-doctor/run-sync.test.mjs`): a dirty
`data/members.yaml` must not block; a dirty framework-owned file the overlay
would write must; an instance-authored `scripts/our-tool.mjs` must not; an
uncommitted *deletion* of a file the overlay would restore must; `unchanged`
content must not; and the no-plan fallback must refuse. **407 tests green.**

---

## B. Fleet result

| Instance | Blockers before → after | Warnings | Root commit | Identity | Receipt |
|---|---|---|---|---|---|
| bread-coop-os | **8 → 5** | 9 → 4 | unchanged `2f36a4d` | unchanged | `memory/reports/sync-receipt-2026-08-29.md` |
| regen-coordination-os | **9 → 8** | 11 → 5 | unchanged `5f09862` | unchanged | `memory/reports/sync-receipt-2026-08-29.md` |
| dao-os | **3 → 3** | 11 → 6 | unchanged `2c94bec` | unchanged | `memory/reports/sync-receipt-2026-08-29.md` |
| regen-toolkit | **4 → 4** | 10 → 6 | unchanged `0e499a5` | unchanged | `memory/reports/sync-receipt-2026-08-29.md` |

Each instance took 3 sync commits (declared upstream, machinery, overlay).
Snapshot refs, all recoverable:

- bread-coop-os `refs/snapshots/20260829-012829Z-doctor-sync`
- regen-coordination-os `refs/snapshots/20260829-012921Z-doctor-sync`
- dao-os `refs/snapshots/20260829-013629Z-doctor-sync`
- regen-toolkit `refs/snapshots/20260829-013716Z-doctor-sync`

**Not synced, per the brief:** `refi-bcn-os` (4 blockers, 34 dirty) and
`refi-dao-os` (4 blockers, 177 dirty) — production, and refi-dao carries the two
🔴 kms data-loss items gating v0.6 Active-1. Verified untouched after the run:
identical HEAD, identical dirty counts, zero sync commits.

### The gate, on real trees

Every run reported it: *"3005 uncommitted change(s) present, none in this run's
write set"* (regen-toolkit), *"9 … none in this run's write set"*
(bread-coop-os). Under the old gate all four instances would have refused at
stage 1. **Zero** of the 2,994 generated `kb-graph/` files in regen-toolkit were
committed, staged, or written — confirmed by `git log --name-only` over the
three sync commits.

### dao-os — the one collision, resolved by the operator

`scripts/update-version.mjs` was **not** a stray copy of the framework script,
as the brief assumed. It is independently authored, with a
`<major|minor|patch> [--instance-tag=]` CLI against the framework's
`<new-version>` / `--check`, and it arrived with `docs/VERSION-MANAGEMENT.md`,
`VERSION.md`, `CHANGELOG.md` and an uncommitted `package.json` `version:update`
entry — one coherent, never-committed feature. Overwriting it would have broken
dao-os's own documented `npm run version:update -- patch` with no visible cause.

Operator chose the rename. Landed as dao-os `ab71bc3`: script renamed to
`scripts/bump-version.mjs`, all six references repointed, verified still
executable, committed with explicit paths. dao-os keeps its bumper *and* gains
the framework's more capable one. `AGENTS.md` and `IDENTITY.md` carry unrelated
uncommitted edits and were deliberately left alone.

---

## C. What did not clear, and why

**No instance reached zero blockers, so all four aborted at `re-assess` and
none got a `last_sync_commit` stamp.** That is the B9 containment rule working
as designed — a stamp asserts a clean lineage — but it means the handoff's
acceptance ("`last_sync_commit` stamped") is **not met for any instance**.

Two instances did not reduce their blocker count at all (dao-os 3→3,
regen-toolkit 4→4), so they miss the "fewer blockers than it started" bar too.
Reported rather than forced, per the WS-H precedent.

The reason is structural, not a sync failure. Every remaining blocker is
**instance-owned content the overlay is forbidden to touch**:

| Blocker | Instances | Why the overlay can't fix it |
|---|---|---|
| `identity-name-disagreement` / `template-leakage` | bread-coop (`dao.json` name="org-os"), regen-coordination (`dao.json`="ReFi Barcelona", `package.json`="organizational-os-template"), regen-toolkit (`dao.json`="ReFi Barcelona") | `.well-known/`, `package.json` are INSTANCE_OWNED. The doctor reports name disagreements and never resolves them — picking the right name is an organizational decision. |
| `version-surfaces-contradict` | bread-coop, regen-coordination, dao-os | All three carry a `CHANGELOG.md` claiming 1.0.0/3.0.0 while `federation.yaml` now reads 0.5. CHANGELOG is INSTANCE_OWNED. |
| `script-target-missing` | bread-coop, regen-coordination | Their `package.json` points at `quartz/bootstrap-cli.mjs` and `scripts/setup-cursor-rules.mjs`, which do not exist. |
| `package-json-duplicate-key` | regen-coordination | Duplicate `scripts.initialize`. |
| `structure-invalid` / `schemas-invalid` | regen-coordination, dao-os (18 failing), regen-toolkit | dao-os is a turbo monorepo, not an org-os-shaped tree. Note the ruler is constant: the doctor runs the **framework's** validators against every target, so this is not measurement drift. |
| `framework-version-missing` | regen-toolkit | Its `federation.yaml` predates the metadata block, so migrate had nothing to re-stamp. |

**The propagation half of v0.6 Active-1 is therefore blocked on identity and
version-surface repair in each instance, not on sync tooling.** The tooling now
works; what remains is per-instance content the framework must not decide.

### Two findings worth carrying

1. **An aborted run leaves the migrate + generate-schemas writes uncommitted.**
   bread-coop, regen-coordination and dao-os each ended with a modified
   `federation.yaml` (and regenerated `.well-known/`, re-stamped `VERSION.md`)
   sitting in the working tree, because the receipt stage never ran. Visible and
   revertable, and it does not block a retry (all instance-owned, so outside the
   write set) — but the doctor makes trees dirtier when it fails. Worth an
   explicit decision: roll back on abort, or commit the re-stamp as its own
   stage the way machinery and overlay already do.

2. **`re-assess` is all-or-nothing.** An instance that improves 8→5 is reported
   identically to one that improves 0. A "did this run make things better?"
   comparison against the pre-sync scorecard would let the doctor distinguish
   progress from stasis, and would have let bread-coop bank its stamp.
