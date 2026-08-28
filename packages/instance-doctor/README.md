# @org-os/instance-doctor

Assess any org-os instance, and plan a framework sync.

```bash
npm run doctor                              # assess the current workspace
npm run doctor -- --dir ../refi-med-os      # assess a sibling (hub mode)
npm run doctor -- sync --dir ../refi-med-os --dry-run
npm run doctor -- sync --dir ../refi-med-os   # v0.5: unproven — see below
```

**Status (v0.5):** `assess` and `sync --dry-run` are proven against the live
fleet (all six real instances + the framework). A **full `sync` is not**: its
stage 5 delegates to `scripts/sync-upstream.mjs`, whose rebase assumes fork
lineage, and every real instance is a scaffold with its own root commit — the
2026-08-28 acceptance run (`memory/reports/ws-h-acceptance-2026-08-28.md`)
demonstrated the failure and stopped the release tag until the claim was
narrowed. The file-level overlay replacement targets v0.5.1.

Operator flow, scorecard reference and the full stage list live in
[`skills/instance-doctor/SKILL.md`](../../skills/instance-doctor/SKILL.md).
This file covers how the package is put together.

## Why it exists

Instances are supposed to update themselves with `scripts/sync-upstream.mjs`.
The 2026-08-28 fleet sweep found that none of them could:

| Instance | What was wrong |
|---|---|
| `refi-bcn-os` | `sync:upstream` script entry, no such file |
| `refi-dao-os` | 178-byte console-only stub, and no `upstream` remote |
| `regen-coordination-os` | duplicate `scripts.initialize`, no sync file, still package-named after the template |
| `refi-med-os` | `upstream` pointing at a live *divergent* legacy repository |
| `bread-coop-os` | no git remote at all; `.well-known/dao.json` publishing the framework's identity |
| `dao-os` | dormant, no sync machinery |

None of that was visible to any existing validator. An instance cannot repair
its own updating mechanism using its own updating mechanism, so the doctor runs
from the framework against the instance and supplies the machinery.

## Shape

```
src/
  snapshot.mjs      the ONLY module that touches the filesystem
  assess.mjs        composes the six checks over one snapshot
  checks/           identity · lineage · versions · machinery · structure · freshness
  report.mjs        scorecard, --json, exit codes
  sync.mjs          the pure half of sync: plan, re-stamp, lineage stamp, receipt
  run-sync.mjs      the stage runner and its abort-on-first-failure rule
  io.mjs            every side effect, in one injectable bag
  cli.mjs           argument parsing and the operator output
```

Two rules hold the design together:

**Every check is a pure function `snapshot → CheckResult`.** No check performs
I/O, so its fixtures are plain objects, its tests are instant, and adding a
check never means adding a mock. All reading happens once, in `snapshot.mjs`.

**Every side effect is injected.** `runSync` takes an `io` bag, so stage
ordering, abort containment, and receipt contents are all testable without a
network or a real instance.

## Tests

Test files live under the repository's root `tests/instance-doctor/`, not in
this package. That is deliberate: `npm test` globs `tests/**/*.test.mjs`, so a
suite inside `packages/` would be invisible to `npm test`, to `npm run selftest`
and to CI — which is exactly what happened to two earlier package suites. See
`tests/helpers/instance-fixtures.mjs` for the on-disk fixture builders, which
model the six real shapes in the table above.

```bash
npm test                                        # everything
node --test "tests/instance-doctor/*.test.mjs"  # just this package
```

## Notes for future work

- `checks/versions.mjs` holds the only copy of the `3.x ↔ 0.x` re-baseline map,
  and cites the `[0.5.0]` paragraph in `CHANGELOG.md` as its source of truth.
  Do not add a second map.
- `checks/machinery.mjs` holds `KNOWN_WRONG_UPSTREAMS`: the repository names
  that have circulated as "the framework" and are not. Add to it rather than
  scattering URL checks.
- The machinery skew fingerprint exists so copy-decay — the defect class behind
  every row in the table above — becomes visible instead of silent.
