# Overlay sync acceptance — 2026-08-29

**Verdict: PASSED.** `doctor sync` completed all nine stages against a real
instance for the first time. The architectural blocker that failed WS-H on
2026-08-28 and narrowed the v0.5.0 reliability claim is closed.

## What changed

Stage 5 no longer shells out to `scripts/sync-upstream.mjs`, whose
`git pull --rebase upstream main` assumes the instance is a *fork*. Every real
instance is a *scaffold* with its own root commit — now **eight-for-eight**,
after `regen-toolkit` was registered — so that rebase conflicted on essentially
every shared filename and stranded the repository mid-rebase.

The replacement is a file-level overlay
(`packages/instance-doctor/src/overlay.mjs`): copy framework-owned paths in,
leave everything the organization owns untouched, never delete, and let the
lineage stamp record which framework commit was applied.

## Acceptance target: refi-med-os

Chosen deliberately — it is the instance the rebase damaged, so proving the
replacement on it closes that loop, and it is the only clean tree in the fleet.

**Pre-state** (matching the 2026-08-28 recovery record exactly): `main @
4326c16`, 0 dirty, original root `0b2075f5`, 5 local unpushed commits.

### Run 1 — aborted at `re-assess`, by design

| Stage | Result |
|---|---|
| snapshot → migrate → generate-schemas | ✓ overlay wrote **49 added, 4 updated** |
| re-assess | ✗ 1 blocker remained |
| receipt | · skipped — containment held |

The remaining blocker was **pre-existing instance data, not sync fallout**:
`IDENTITY.md` read `LocalNode (multi-locality coordination)` while
`federation.yaml` read `LocalNode`, and `validate-identity` requires exact
agreement. The overlay had correctly left it alone — identity files are
instance-owned. Fixed in the instance (`082e428`): the descriptor moved to its
own `Scope:` line.

This run is worth recording rather than hiding: B9 containment did exactly what
it exists for. The instance was not left half-migrated, the receipt named the
stage that stopped it, and nothing after `re-assess` ran.

### Run 2 — all nine stages green

```
✓ snapshot          refs/snapshots/20260829-004352Z-doctor-sync
✓ ensure-upstream   already canonical
✓ fetch             fetched upstream
✓ inject-machinery  installed and committed the four machinery scripts
✓ overlay           already current — 57 framework files match
✓ migrate           migrations applied; version surfaces already current
✓ generate-schemas  schemas regenerated
✓ re-assess         WARN — 0 blockers, 7 warnings
✓ receipt           stamped last_sync_commit c951a4f5331a
```

Note stage 5 reporting *"already current — 57 files match"*: the second run is a
clean no-op, which is the idempotence the old rebase could never offer.

## Independent verification

- `doctor assess`: **0 blockers**, 5 warnings (down from 1 blocker / 7 warnings).
- Lineage stamp complete and correct:
  - `genesis_commit: 0b2075f5…` — the instance's own root, unchanged
  - `last_sync_commit: c951a4f5…` — the framework commit applied
  - `framework_version: "0.5"`, `last_updated: 2026-08-29`
- **Integrity:** `IDENTITY.md` still says *ReFi Mediterranean*, root commit still
  `0b2075f5`, branch still `main`, no rebase state. The framework's own identity,
  members, memory and `.well-known/` did **not** leak in — the property
  `overlay.test.mjs` pins.

## Scope of this acceptance

Proven: the overlay mechanism, end to end, on one clean real instance, including
the abort path.

**Not yet proven:** the other seven instances. Six carry uncommitted work
(`dao-os` 7, `bread-coop-os` 9, `regen-coordination-os` 24, `refi-bcn-os` 34,
`refi-dao-os` 168, `regen-toolkit` 2,275) and the doctor correctly refuses to
sync over an operator's uncommitted changes. Those trees are the operator's to
resolve; the sync can run the moment they are.

The original WS-H H2 (`bread-coop-os`, remote-less) and H3
(`regen-coordination-os`, the messy case) remain open for the same reason —
availability of a clean tree, not a defect in the mechanism.
