# 06 — Self-maintenance

> Cell note · instance-primary, framework-secondary
> Aspect type: **invariant** (resistance to entropy)

**Question.** How does an instance stay coherent against drift, entropy, and dead links? What invariants does it check on itself, and how does it recover when one breaks?

## Mechanism (step by step)

The maintenance vocabulary lives almost entirely in `package.json` scripts. There are no pre-commit hooks (the org-os submodule's `.git` is a gitfile pointing at `../../.git/modules/03 Libraries/org-os`; only `*.sample` hooks present), no `.husky/`, and only one CI workflow.

**Maintenance scripts (manual unless noted):**

| Script | npm alias | Checks / does |
|---|---|---|
| `scripts/validate-structure.mjs` | `validate:structure` | 8 sections of structural invariants — see below |
| `scripts/validate-identity.mjs` | `validate:schemas` | **MISSING** — referenced in `package.json` but file does not exist |
| `scripts/generate-all-schemas.mjs` | `generate:schemas` | Reads `data/*.yaml` → writes `.well-known/*.json` (members, meetings, projects, finances, proposals, activities, contracts, ideas, knowledge); silently no-ops on missing inputs |
| `scripts/analyze-instances.mjs` | `analyze:instances` | Walks `data/instances.yaml` × locally-cloned instances; emits drift report to `memory/reports/instances-drift-YYYY-MM-DD.md` |
| `scripts/migrate.mjs` | `migrate` | Reads `federation.yaml.metadata.framework_version`, runs every applicable file under `scripts/migrations/`; idempotent |
| `scripts/update-version.mjs` | `version:update` | Bumps `package.json.version`, mirrors major.minor to `federation.yaml.metadata.framework_version`, promotes CHANGELOG `[Unreleased]` |
| `scripts/sync-upstream.mjs` | `sync:upstream` | **MISSING** — referenced by `package.json` and by `docs/VERSIONING.md` step 2, but file does not exist |

**What `validate-structure.mjs` actually checks** (all manual):

1. 12 required root files: `MASTERPLAN.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`, `TOOLS.md`, `CLAUDE.md`, `README.md`, `federation.yaml`, `package.json`. Plus a warn-only check for legacy `MASTERPROMPT.md`.
2. 6 required dirs: `data/`, `.well-known/`, `memory/`, `skills/`, `packages/`, `scripts/`.
3. 6 required `data/*.yaml` files: `members`, `projects`, `finances`, `governance`, `meetings`, `ideas`.
4. 3 required schemas in `.well-known/`: `dao.json`, `members.json`, `projects.json`. Plus JSON-parse validation of every `*.json` in that dir.
5. Every `skills/<name>/` has a `SKILL.md`.
6. `federation.yaml` has `identity{name,type}`, `federation`, and `agent` sections.
7. `package.json` has `generate:schemas` and `validate:schemas` scripts.
8. **Version consistency** (added by `versioning-system` plan): `package.json.version` major.minor equals `federation.yaml.metadata.framework_version`. Pre-1.0 versions bypass this check.

**Trigger layers — what's actually wired:**

- **Manual:** every script above. Operator must remember to run them.
- **Pre-commit hooks:** none. The directory has only `*.sample` files.
- **CI:** one workflow, `.github/workflows/generate-schemas.yml`. Triggers: push that touches `data/**`, `content/meetings/**`, `content/projects/**`, or `federation.yaml`; daily cron at midnight; manual dispatch. It runs only `generate:schemas` and auto-commits `.well-known/`. **It does not run `validate:structure`, `validate:schemas` (which doesn't exist), or `analyze:instances`.** No PR-blocking workflow exists.
- **Scheduled:** the daily cron above is the only one. `analyze:instances` is **never run automatically** — last drift report on disk is from `2026-04-24`, eight days stale at time of writing (2026-05-02).
- **Session lifecycle:** `/initialize` and `/close` (in `.claude/commands/` and `.opencode/commands/`) do not invoke any validator. `/initialize` renders the dashboard and tolerates stubs silently. The closest thing to a smoke test is whether the dashboard renders at all.
- **Skill-driven:** `skills/workspace-improver/SKILL.md` codifies an autoresearch loop that runs `npm run generate:schemas && npm run validate:schemas` after each scoped change and reverts on regression — but this only fires when an operator says "improve workspace" / "autoresearch."

**One full maintenance cycle — schema drift:**

1. Operator edits `data/projects.yaml` (adds a project).
2. `.well-known/projects.json` is now stale — but no local script flagged it.
3. The change is committed and pushed.
4. GitHub Actions `generate-schemas.yml` triggers on `data/**` push, runs `npm run generate:schemas`, regenerates `.well-known/`, auto-commits `[skip ci]`.
5. Detection happened in CI; recovery happened in CI; no human in the loop. This is the one path that genuinely closes.

**One full maintenance cycle — structural drift (does not close):**

1. A skill is added to `skills/<name>/` without a `SKILL.md`, or a required `data/*.yaml` is deleted.
2. No hook, no CI step catches it. `validate-structure` only runs if the operator types `npm run validate:structure`.
3. The instance can ship a release (`npm run version:update` → tag → push) without ever having validated. The `version:update` script does not invoke validators.
4. A downstream consumer pulling the framework discovers the breakage at runtime, or `npm run analyze:instances` notices it during the next manually-triggered drift sweep — whichever comes first.

The cycle closes when, and only when, an operator remembers to run the validator. That is the central self-maintenance gap.

## Prior art

1. **Biological homeostasis / DNA repair.** Cells maintain identity not by being static but by continuously detecting and patching damage (mismatch repair, nucleotide excision, autophagy clearing damaged proteins). Each repair pathway has a sensor, a signal, and an effector. org-os has effectors (`generate:schemas`, `migrate`) and partial sensors (`validate-structure`), but the signal layer — what wakes the effector — is mostly "operator notices" rather than continuous.
2. **Erlang / OTP supervisor trees ("let it crash").** Tolerate failure of children; supervisors restart from a known-good state. The org-os parallel: the framework is the supervisor (canonical specs, migrations); instances are the children. But there's no automatic "restart from known good" — drift accumulates until manual intervention.
3. **Cybernetics — Beer's VSM System 3* (audit channel).** System 3 manages day-to-day; 3* is the sporadic audit that bypasses normal reporting to verify ground truth. `analyze:instances` is the System 3* of org-os: an out-of-band sweep that reads what's actually on disk, not what instances declare. It matches the VSM pattern but is not run on cadence.
4. **Garbage collection / generational hypothesis.** Most allocations die young; collect them frequently. Few survive long; collect those rarely. org-os has no equivalent: stale `memory/` files, deprecated skills, dead `data/sources.yaml` entries are never reaped. Entropy accumulates unchecked.
5. **Immune system — innate vs. adaptive.** Innate is fast, generic, always on (CI workflow on push). Adaptive is slow, specific, learned (migration scripts encode prior breakages). org-os has innate (one workflow) and adaptive (one migration), with neither well-developed.

## Invariants / failure modes

**Invariants (what must hold for an instance to remain coherent):**

- **I1 — Structural completeness.** Every file/dir in the `validate-structure` checklist exists. Currently checked manually.
- **I2 — Schema validity.** Every `.well-known/*.json` parses as JSON. Checked by `validate-structure` section 4.
- **I3 — Schema freshness.** `.well-known/*.json` reflects current `data/*.yaml`. Closed only by the CI workflow on push events touching watched paths; locally drift can accumulate between `data/` edits and the next push.
- **I4 — Skill well-formedness.** Every `skills/<name>/` has a `SKILL.md`. Checked by `validate-structure` section 5. Frontmatter shape is **not** validated.
- **I5 — Federation manifest validity.** `federation.yaml` is parseable YAML with required sections. Checked.
- **I6 — Version consistency.** `package.json.version` major.minor equals `federation.yaml.metadata.framework_version`. Checked (section 8).
- **I7 — Required scripts present.** `generate:schemas` and `validate:schemas` are in `package.json.scripts`. Checked — but the check verifies the *script entry* exists, not that the *file it points to* exists. `validate:schemas` currently passes this check while pointing at the missing `validate-identity.mjs`.
- **I8 — Registry referential integrity.** No orphan references (e.g., `data/skills-matrix.yaml` lists a skill that has no `skills/<name>/` directory; or vice versa). **Not checked** by any local script. `analyze-instances.mjs` checks this *across* instances (`unmapped_skill`, `unmapped_package`, `undeclared_data_registry` drift items) but not within a single instance.
- **I9 — Required-data-file presence.** `data/members.yaml` etc. exist. Checked. But the *contents* (e.g., `members[].id` is unique, `projects[].lead` references an existing member) are **not** checked anywhere.
- **I10 — Migration applicability.** Every breaking framework change has a migration in `scripts/migrations/` and a doc in `docs/migrations/`. Policy in `docs/VERSIONING.md`; **not enforced** by any script.
- **I11 — Drift-report freshness.** `memory/reports/instances-drift-*.md` exists and is recent. **Not checked.** Currently 8 days stale.

**Failure modes:**

- **F1 — Silent drift.** An invariant breaks and no script catches it because the script must be run manually and wasn't. Examples: I3 between local edits, I4 frontmatter shape, I8, I9 content-level integrity, I11 freshness. This is the dominant failure mode.
- **F2 — Catch-without-recovery.** A script catches a problem but the recovery path is undocumented. Example: `validate:structure` reports `MASTERPROMPT.md` should be renamed to `MASTERPLAN.md` — recovery is implicit. Example: `analyze:instances` reports `framework_version_mismatch` — the runbook is "run `npm run migrate` on the affected instance," but that's only inferable from `docs/VERSIONING.md`, not surfaced in the report itself.
- **F3 — Phantom script.** A script is referenced in `package.json` but the file does not exist. Confirmed: `validate:schemas` → `validate-identity.mjs` (missing); `sync:upstream` → `sync-upstream.mjs` (missing). Calling `npm run validate:schemas` errors out; the CI workflow doesn't call it so the gap is invisible.
- **F4 — Generator without inverse.** `generate-all-schemas.mjs` writes `.well-known/` from `data/` but there is no validator that asserts the reverse — that `.well-known/` is current relative to `data/`. After a failed `generate:schemas`, the two diverge with no script to detect it. The CI workflow auto-commits, masking the issue.
- **F5 — Migration not produced.** A breaking framework change ships without a migration script. Policy says it must (`docs/VERSIONING.md`); nothing enforces it.
- **F6 — Drift accumulates undetected across instances.** `analyze:instances` is manual; report is 8 days old; the system-reliability plan calls out `refi-dao-os` going ~7 weeks without sync. There is no SLA, no alert threshold.
- **F7 — Silent stub tolerance at boot.** `/initialize` renders the dashboard even when canonical files are stubs or missing sections. The render-as-smoke-test is too lenient to catch decay.

## Open questions

1. **Pre-commit layer.** Are there hooks today, or only manual `npm run validate:*`? **Confirmed: no pre-commit hooks exist** (only `*.sample` files in `.git/modules/.../hooks/`). Should structural validation run as a pre-commit hook on every commit, or only on commits that touch `data/`, `skills/`, `federation.yaml`, `package.json`?
2. **Scheduled jobs.** Beyond the daily `generate-schemas.yml` cron, what scheduled jobs exist? Currently none. Should `analyze:instances` run weekly via a scheduled GitHub Action and commit the report to `memory/reports/`? The system-reliability plan explicitly proposes this.
3. **Federation drift SLA.** What's "too long" without sync? `refi-dao-os` at ~7 weeks — broken or dormant? The drift report doesn't grade severity.
4. **Recovery when `data/` and `.well-known/` diverge.** If `generate:schemas` half-runs (one file written, error in the next), what's the recovery path? Today: re-run, hope it's idempotent. There's no "rollback to last known-good `.well-known/`" or `git checkout -- .well-known/` cookbook.
5. **Where is `validate-identity.mjs`?** The `validate:schemas` npm script points at a file that doesn't exist. Was it deleted? Renamed? Never written? Either restore the script or remove the entry.
6. **Where is `sync-upstream.mjs`?** Same question. `docs/VERSIONING.md` step 2 of "Instance migration — pull-based" says to run `npm run sync:upstream`, but the script doesn't exist. The pull-based migration story has a missing pulley.
7. **Self-test surface.** Should `/initialize` strict-mode block on stub canonical files (turning the dashboard render into a real smoke test), or should there be a separate `npm run selftest`? The system-reliability plan flags this as Q5 unresolved.
8. **Framework-frontmatter validation.** `SKILL.md` frontmatter has a documented shape (`name`, `version`, `description`, `triggers`, etc., per `docs/SKILL-SPECIFICATION.md`). No validator parses it.
9. **Within-instance referential integrity.** Should `validate-structure` (or a new `validate-references` script) check that `data/skills-matrix.yaml` ↔ `skills/`, `members.yaml.id` is unique, `projects.yaml.lead` ∈ `members.yaml`, etc.?
10. **Operator notification when an invariant breaks but isn't acted on.** `analyze:instances` exits 0 even when drift is reported (`drift is informational, not a failure`). Is that the right default? Per system-reliability plan, the answer for CI is "no — block PRs."

## Existing-plan touchpoints

- **`docs/agent-plans/system-reliability.md`** — *the* canonical plan for this aspect, queued at priority 6, est. 3 sessions. Phase 1 audits existing checks (everything in this note); Phase 2 picks the trigger layer for each (pre-commit / CI / scheduled / manual); Phase 3 implements pre-commit hooks, a `.github/workflows/validate.yml` that blocks PRs, a scheduled drift-report workflow, and a recovery runbook in `docs/RELIABILITY.md`. This research note should feed directly into Phase 1's audit. Phase 1 should confirm/refute findings F3 (phantom scripts) and F6 (no SLA) here.
- **`docs/agent-plans/versioning-system.md`** — completed 2026-04-24. Delivered `validate-structure` section 8 (version consistency, I6), `migrate.mjs`, `update-version.mjs`, the `[Unreleased]` discipline, and `docs/VERSIONING.md`. Versioning discipline *is* part of self-maintenance; this plan is the floor on which `system-reliability` builds. Open follow-up listed there: "Add a CHANGELOG check to CI if/when CI lands" — that's a concrete handoff into `system-reliability` Phase 3.
- **`docs/agent-plans/instance-bootstrap.md`** — Phase 1 task explicitly says "Verify a fresh clone passes `npm run validate:structure` immediately." The bootstrap pipeline must produce instances that satisfy I1–I7 on day zero. If `validate-structure` is the contract, then the bootstrap script and the validator co-evolve; if a new required file is added to `validate-structure`, `instance-bootstrap`'s scaffolding must produce it.
- **`skills/workspace-improver/SKILL.md`** — codifies the local autoresearch loop: measure → change → re-validate → keep-or-revert. This is the closest thing to an in-skill self-maintenance loop. It runs `validate:schemas` (the missing one — would silently fail today). Updating `workspace-improver` to call `validate:structure` *and* the eventual `validate:schemas` would give every autonomous improvement session a real safety net.

## Framework-level note

The framework's own self-maintenance is the same set of scripts run against itself: this repo's `npm run validate:structure` validates the framework as if it were an instance (the validator is path-agnostic — `node scripts/validate-structure.mjs [path]`); `generate-all-schemas.mjs` regenerates `.well-known/` from this repo's own `data/`; CI does the same on push. Two specifically framework-only mechanisms exist on top: `analyze-instances.mjs` reads `data/instances.yaml` (a registry that exists *only* in the framework, not in instances) and inspects every locally-cloned downstream — its output (`memory/reports/instances-drift-*.md`) is the framework's view of the population's health. And `update-version.mjs` + `scripts/migrations/` is the framework's discipline for changing its own shape without breaking children: every breaking change ships with a migration so any instance can pull and `npm run migrate` to catch up. The framework's gaps mirror the instance's: the version policy demands migrations for breaking changes, but nothing enforces "this commit changed a canonical file shape and has no migration." The same `system-reliability` plan covers both levels — the layered validators and the scheduled drift sweep are framework-level mechanisms whose outputs cascade to instances.
