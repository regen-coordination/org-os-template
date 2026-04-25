# Reliability Audit — 2026-04-25

## Existing checks

- `npm run validate:schemas` → `scripts/validate-identity.mjs` (recently stubbed in pre-flight; minimal JSON validator)
- `npm run validate:structure` → `scripts/validate-structure.mjs`
- `npm run analyze:instances` → `scripts/analyze-instances.mjs`
- `scripts/migrations/` — only `v2-to-v3-workstream-frontmatter.mjs` (single migration)
- `.github/workflows/` — only `generate-schemas.yml` (no validator/test workflows)
- No pre-commit hook
- No `selftest` script in `package.json`

## Gaps (failure mode × layer)

| Failure mode | Manual | Pre-commit | CI | Scheduled |
|---|---|---|---|---|
| Data integrity (schema/structure) | yes | NO | NO | NO |
| Agent runtime correctness | partial (/initialize) | NO | NO | NO |
| Federation drift | yes (`analyze:instances`) | N/A | NO | NO |
| Recovery | undocumented | N/A | N/A | N/A |

## Recent latent signals (from memory/)

No reliability-incidents-as-such are recorded in the current memory log
(`memory/2026-04-24.md`, `memory/2026-04-25.md`, `memory/reports/instances-drift-2026-04-24.md`),
but three latent reliability signals surface:

- **Stub-as-validator risk** — `scripts/validate-identity.mjs` was just stubbed in pre-flight as a "real-but-minimal JSON validator." Without a CI gate, future stubs can slip into `main` undetected.
- **Non-clonable instance** — `regen-coordination-os` reported `not_cloned_locally` in the 2026-04-24 drift report and is still pending resolution per `2026-04-25.md`. This is the kind of drift that a scheduled `analyze:instances` run would surface automatically.
- **Detached HEAD note** — `2026-04-24.md` "Next" list flags `Resolve detached HEAD situation (branch is currently HEAD)` — a classic recovery scenario the runbook should cover.

## Recommended layering

Reference: §7 of `docs/superpowers/specs/2026-04-25-org-os-3-5-release-design.md`.

Four trigger layers, each enforcing ≥1 failure mode, with no failure mode left unenforced:

1. **Pre-commit** (local, fast) — `validate:structure` always; `validate:schemas` if `data/*.yaml` touched.
2. **CI** (push/PR, thorough) — full validator suite + `npm run selftest` (incl. clone-engine dry-run).
3. **Scheduled** (weekly Sun 04:00 UTC) — `analyze:instances`, commits a fresh drift report.
4. **Manual** (operator on demand) — `npm run selftest` for the agent-runtime smoke test.

A new `npm run selftest` becomes the agent-runtime smoke contract:
- `/initialize` stays fast (< 5s) and tolerant of missing files.
- `selftest` is allowed to be slow (up to 60s) and exits non-zero on any failure mode.

Documented in `docs/RELIABILITY.md` as the framework's reliability contract.
