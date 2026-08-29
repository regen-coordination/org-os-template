# Clean-room re-run — 2026-08-29 (WS-I I6, against the polished kit)

**Verdict: PASSED.** The Harbor Bakery protocol (task-14 brief), repeated
against the v0.5.0 adoption kit: fresh clone → docs-only → agent-driven →
**a valid instance, doctor-clean except the one expected finding, zero
identity leaks.** The 2026-08-21 run's B1–B7 newcomer blockers are closed on
the recommended path.

## Protocol

- **Persona:** same as 2026-08-21 — "Harbor Bakery Co-op", a 9-person
  worker-owned bakery; terminal-comfortable, knows nothing about DAOs/ReFi.
- **Docs-only rule:** the run followed `docs/ADOPT-WITH-AN-AGENT.md` verbatim
  (the doc README + BOOTSTRAP now route newcomers to), plus the config
  template in `BOOTSTRAP.md`. No source was read to make the path work.
- **Agent-driven:** every step executed from a non-TTY agent shell — the exact
  condition that hard-stopped the 2026-08-21 run at `npm run setup`'s first
  prompt (B2). The recommended path never needs a TTY.
- **Clean room:** `/tmp/adopt-verify3`, fresh clone.
- **Deviation (logged, now closed):** the first run cloned from the local repo
  at `feat/adoption-kit`, since the kit under test was not yet merged.
  **Confirmation re-run completed after PR #3 merged** — `git clone` from
  public GitHub `main` @ `bffe188`, recipe followed verbatim, different
  operator identity ("Ana Ferreira") to be sure nothing was carried over from
  the first run. Same result: `schemas PASS`, `structure PASS`, **1 blocker
  (`git-remote-absent`, expected)**, `dao.json` = `harbor-bakery-os`,
  `IDENTITY.md` = `harbor-bakery-os`, members = `["Ana Ferreira"]`, projects
  `[]`, frontier cache absent, **zero leaks** across `data/`, `SOUL.md`,
  `USER.md`, `TOOLS.md`, `IDENTITY.md` (sweep also covered the framework's
  Gnosis/llamarpc endpoints). The public path is verified end-to-end.

## Timeline

Clone → `npm install` → write `my-org.yaml` (from the BOOTSTRAP template) →
`npm run clone:framework -- --target ../harbor-bakery-os --config my-org.yaml`
→ inside the instance: `npm install`, `npm run generate:schemas`,
`npm run validate:schemas`, `validate-structure` → from the framework:
`npm run doctor -- --dir ../harbor-bakery-os`. Wall-clock dominated by the two
`npm install`s; the org-os steps take seconds.

## Gates

| Gate | 2026-08-21 (wizard path) | 2026-08-29 (recommended path) |
|---|---|---|
| Agent can complete setup at all | ✗ B2 — stuck at prompt 1 forever | ✓ non-interactive end-to-end |
| Instance identity is the org's | ✗ B3 — `IDENTITY.md` still org-os | ✓ `harbor-bakery-os` everywhere |
| `dao.json` published, correct | ✗ B6 — skipped, name `org-os` | ✓ written, `name: harbor-bakery-os` |
| Maintainer data stripped | ✗ B4 — members/projects/TOOLS leaked | ✓ **zero leaks** (members = operator only; projects/ideas/ecosystems/relationships empty; SOUL/USER/TOOLS reset; frontier cache removed) |
| First dashboard shows the org's world | ✗ B5 — 13 framework projects, 54 tasks | ✓ empty registries awaiting Phase 1 |
| Validators honest | ✗ B7 — full pass on a leaked instance | ✓ pass on a genuinely-clean instance; doctor reports the one true finding |
| Doctor scorecard | n/a (didn't exist) | **1 blocker: `git-remote-absent`** (expected — no remote yet), 5 warnings, all with hints |

## What the run caught while being built (fixed on the branch)

1. **Step-order defect in the recipe:** the clone ships `.well-known/` as
   templates by design, so `validate:structure` fails until
   `generate:schemas` publishes the instance's descriptors. Recipe reordered;
   this is why the doc says "order matters."
2. **The residual B4/B5 leak in the engine itself:** a fresh instance carried
   the maintainer's member entry, 13 framework projects, framework
   ideas/ecosystems/relationships, the framework's SOUL and tool endpoints,
   and the federation frontier cache. Fixed by clone-framework stage 4b
   (identity stripped by construction) and pinned by a no-leak test in
   `tests/clone-framework-health.test.mjs`, including a catch-all assertion
   that the maintainer's identity appears nowhere in a fresh instance's
   data or identity files.

## Still true, still documented

- `npm run setup` remains TTY-only and un-retested end-to-end; every doc now
  frames it as the in-place alternative and lists its real nine prompts.
- The fork-target/blank-template decision (clean-room B3–B6 *for the fork
  path*) stays deferred — the recommended path now genuinely sidesteps it by
  construction, which was the premise of deferring it.
