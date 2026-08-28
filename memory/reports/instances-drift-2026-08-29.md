# Instance Drift & Acceptance Report — 2026-08-29 (v0.5.0 ship day)

The WS-H acceptance record for the **narrowed** v0.5 reliability claim
(`assess` + `sync --dry-run`, per the 2026-08-29 operator decision executing
option 2 of [`ws-h-acceptance-2026-08-28.md`](ws-h-acceptance-2026-08-28.md)).
Raw structural drift lives in the auto-generated
[`instances-drift-2026-08-28.md`](instances-drift-2026-08-28.md) (refreshed
this run); this report adds the doctor's acceptance scorecards.

Framework at `bb60ee6` (release candidate), version 0.5.0.

## Doctor assess — all seven checkouts

| Checkout | Blockers | Warnings | Exit | Note |
|---|---:|---:|---:|---|
| **framework (`org-os`)** | **0** | 5 | 0 | self-assess clean; warnings are the "never-synced hub" set |
| `refi-med-os` | 1 | 7 | 1 | down from 2/12 on 08-28 after the recovery repairs; remaining blocker: `schemas-invalid` (1 failing identity check) |
| `bread-coop-os` | 8 | 9 | 1 | incl. the missing-git-remote BLOCKER with remediation hint — the H2 signature, correctly surfaced |
| `regen-coordination-os` | 9 | 11 | 1 | the messy case: template-name leakage + dup `initialize` key + missing machinery, all flagged |
| `refi-bcn-os` | 4 | 9 | 1 | production; assess-only by design (F4) |
| `refi-dao-os` | 4 | 13 | 1 | production, dirty tree + 🔴 kms ledger items; assess-only by design (F4) |
| `dao-os` | 3 | 11 | 1 | dormant since March; freshness checks fire as designed |

Non-zero exits on instances are the deliberate blocker-exit-code contract, not
failures: every scorecard is honest, every blocker carries a remediation hint,
and the framework itself is the only checkout expected to be blocker-free.

## Doctor sync --dry-run — dirty production trees

| Instance | Exit | Result |
|---|---:|---|
| `refi-bcn-os` | 0 | full 9-stage plan generated, read-only, no mutation |
| `refi-dao-os` | 0 | full 9-stage plan generated, read-only, no mutation |

Plan generation survives both dirty production trees — the property v0.6
Active-1 depends on before any real propagation is attempted.

## What this does and does not prove

- **Proven:** `assess` across the entire live fleet plus the framework;
  `sync --dry-run` against the two hardest (dirty, production) trees.
- **Not proven, and not claimed:** a full `doctor sync`. The 2026-08-28 run
  demonstrated the history-based strategy cannot apply to scaffolded
  instances (no instance shares the framework root — verified six-for-six).
  Recorded as a 🔴 Known issue in `CHANGELOG.md [0.5.0]`; file-level overlay
  redesign targets v0.5.1, after which the original WS-H H1–H3 re-run in full.
- Fleet propagation remains **v0.6 Active-1**, gated on the F4 kms data-loss
  fixes.

## Verdict

**Narrowed acceptance PASSED.** WS-G (tag `v0.5.0`) is unblocked.
