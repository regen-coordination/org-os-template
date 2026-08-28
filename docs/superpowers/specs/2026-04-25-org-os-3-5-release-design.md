---
id: org-os-3-5-release
title: "org-os v3.5 — Ready for Real Orgs (Release Design)"
status: superseded (0.x re-baseline; branches archived)
type: release-spec
target_version: "3.5.0"
created: 2026-04-25
last_updated: 2026-04-25
brainstorming_session: 2026-04-25
operator: luizfernandosg
acceptance_instance: bread-coop-os
---

# org-os v3.5 — Ready for Real Orgs

> **Theme:** A new instance can be cloned, operated daily, and stay in sync with the framework — proven by `bread-coop-os` going live.

This is a **release spec**, not a feature spec. It pulls a subset of existing scoping plans across the finish line, adds two new pieces of work (one-pager templates, bread-coop-os bootstrap), and defines what "v3.5" means as a coherent release. Each included sub-plan keeps its own implementation plan; this document defines the release container, sequencing, and acceptance gates.

---

## 1. Ready-bar (what "done" means)

v3.5 is done when **all** of these are true:

1. A non-framework operator can clone org-os and have a working instance in **< 30 min**, including identity capture, package selection, and one ingested knowledge source.
2. The instance has a clean `README.md` and a flowy `GETTING-STARTED.md`, both generated from framework templates with org-specific context.
3. Schema/structure validators are **enforced** at pre-commit and CI layers — silent rot is no longer possible.
4. Packages selected at clone time are **materialized** on disk, version-pinned to framework, updatable via one command.
5. **`bread-coop-os` is live**: cloned via the new engine, dashboard renders with org-specific identity, governance-aware data registries populated, first operator session logged.
6. `org-os` itself plus all four currently-cloned downstream instances (`refi-bcn-os`, `refi-dao-os`, `regen-coordination-os`, `dao-os`) pass `npm run selftest` cleanly.

If any of (1)–(6) is not true, v3.5 is not done.

---

## 2. Scope: plans included

| Sub-plan | Status entering v3.5 | v3.5 outcome |
|---|---|---|
| `instance-bootstrap` | scoping | **Built** — `scripts/clone-framework.mjs` engine + GitHub Template config + extended `bootstrap-interviewer` skill |
| `package-integration` | scoping | **Built** — `scripts/sync-packages.mjs` (npm: `sync:packages`) + `docs/PACKAGE-LIFECYCLE.md` + `lifecycle_status` field on `packages-matrix.yaml` |
| `system-reliability` | scoping | **Built** — pre-commit hook + `.github/workflows/validate.yml` + scheduled drift workflow + `docs/RELIABILITY.md` + `npm run selftest` |
| `one-pager-templates` *(new)* | — | **Built** — `templates/README.framework.md`, `templates/README.instance.md`, `templates/GETTING-STARTED.md`; cloning engine renders them with org context |
| `bread-coop-os-bootstrap` *(new)* | — | **Acceptance test** — bread-coop-os instance live, drift = 0, dashboard rendering, Luiz's first session logged |

Each sub-plan keeps its own implementation plan in `docs/agent-plans/`. This release spec defines what they collectively mean for v3.5.

---

## 3. Scope: plans deferred (explicit)

| Plan | Deferred to | Why |
|---|---|---|
| `obsidian-interface` | **v3.6** (immediately after) | Operator UX layer — best done after operation flows prove themselves on bread-coop-os |
| `obsidian-canvas-interface` | v3.6 (after `obsidian-interface`) | Depends on `obsidian-interface` |
| `non-tech-onboarding` | v3.6 | Web wrapper over the cloning engine — natural follow-up once engine is proven |
| `tui-dashboard` | v3.7 | 28-task plan ready; agent-rendered ASCII is sufficient until then |
| `framework-dashboard-template` | v3.7+ | Becomes a thin renderer over `tui-data` once TUI lands |
| `federation-protocol` | v3.6+ | Not on the bread-coop-os critical path; bread-coop-os doesn't federate at MVP |
| `future-instance-specs` | v3.6+ | `regen-coordination-os` already exists; `regen-toolkit` isn't urgent |

Deferring is a feature, not a failure. v3.5's job is to make org-os *real-org-ready*, not to ship every operator-UX experiment.

---

## 4. The cloning engine (the keystone)

`scripts/clone-framework.mjs` is the single source of truth for what an instance looks like at birth.

### Invocation

```bash
node scripts/clone-framework.mjs \
  --target ../bread-coop-os \
  --type cooperative \
  --interactive   # runs bootstrap-interviewer skill prompts
```

Optional flags:

- `--force` — wipe target dir if non-empty
- `--non-interactive --config <file>` — read answers from `<file>.yaml` (for CI / scripted bootstraps)
- `--dry-run` — show what would happen, write nothing

### Behavior (in order)

1. **Verify target.** Empty dir or `--force`. Refuse to overwrite a non-empty dir without `--force`.
2. **Copy framework files.** Everything in the org-os working tree except the explicit strip list.
3. **Strip framework-only artifacts** from target:
   - `data/instances.yaml`
   - `data/skills-matrix.yaml`
   - `data/packages-matrix.yaml`
   - `docs/SKILL-PROMOTION.md`
   - `docs/PACKAGE-LIFECYCLE.md` (the new doc — framework-only)
   - `scripts/clone-framework.mjs` (this script — instance doesn't need to clone itself)
   - `scripts/analyze-instances.mjs` (framework-only orchestration)
   - `templates/` (framework-only — already rendered into target)
   - `.well-known/instances.json` (framework-only when published)
4. **Reset framework-specific markdown** to instance-template defaults:
   - `MEMORY.md` Key Decisions section emptied (delegate stays pointing to `DECISIONS.md`)
   - `memory/` directory cleared, replaced with seed `memory/{{today}}.md` welcome note
   - `HEARTBEAT.md` task list reset to instance-bootstrap defaults (e.g., "Run /initialize for the first time", "Process your first meeting")
   - `MASTERPLAN.md` reset to instance template (1-page placeholder pointing at `bootstrap-interviewer`)
   - `DECISIONS.md` reset to "no decisions logged yet"
5. **Run `bootstrap-interviewer` skill** (extended in v3.5 with package + skill selection):
   - Identity (name, type, mission, emoji, short_description)
   - Members (operator, contributors)
   - Channels (Telegram / Discord / Discourse / etc.)
   - Federation (network membership, peers, upstream)
   - Packages selection (default: minimal set; opt-in per package, with descriptions)
   - Skills selection (default: all canonical 10; opt-out per skill, with rationale captured)
   - Knowledge sources (at least one — proof of pipeline)
6. **Render one-pager templates** with collected context → write `README.md` + `GETTING-STARTED.md` (instance variant — see §6).
7. **Materialize selected packages** via `scripts/sync-packages.mjs` (npm script: `npm run sync:packages`; see §5).
8. **Materialize selected skills.** Copy from `skills/` if `enabled: true`; omit otherwise.
9. **Write `federation.yaml`** with framework_version pin and selected toggles.
10. **Run `npm install`**, then `npm run validate:schemas && npm run validate:structure` — **must pass** before completing. If validators fail, abort with diagnostic output (instance is left in inspectable state, not deleted).
11. **Initialize git**, make initial commit titled `bootstrap: initial scaffolding from org-os v{{framework_version}}`.
12. **Print next-steps**:
    - How to add the new instance to the org-os hub's `data/instances.yaml`
    - How to push to a new GitHub repo
    - How to run the first `/initialize`

### GitHub Template wrapping

org-os repo gets `template: true` in repo settings. A `.github/template-cleanup.yml` workflow runs on first clone-from-template to call the engine in `--non-interactive` mode using inputs from a GitHub Issue form. This makes the engine accessible to operators who clicked "Use this template" instead of using the CLI.

For v3.5: the GitHub Actions wrapper is implemented but optional — the CLI path (used by Luiz to bootstrap bread-coop-os) is the primary release-blocker.

### Invariants

- A fresh instance from this engine MUST pass `npm run validate:structure` and `npm run validate:schemas` immediately. This is a CI-enforced check (see §7).
- The engine is idempotent in the sense that re-running with the same config against the same target (with `--force`) produces a byte-identical result modulo the seed memory note's date.

---

## 5. Package consumption mechanism

Resolves open question 1 from `package-integration.md`.

### Mechanism

**Vendored copies, sync-pulled.** `federation.yaml` carries the toggle, `scripts/sync-packages.mjs` (exposed as `npm run sync:packages`) does the materialization, packages live in `packages/` on disk in the instance.

### Disk layout

```yaml
# In an instance's federation.yaml:
packages:
  dashboard: true
  operations: true
  webapps: true
  regen-agents: true
  paperclip-agents-app: false
  agents-app: false
  egregore-core: false
  koi-bridge: false
  koi-opal-bridge: false
  opal-bridge: false
```

After `npm run sync:packages` runs:
- Each enabled package exists at `packages/<id>/` as a copy of the framework's version, pinned to `framework_version`.
- Each disabled package is absent. If a local `packages/<id>/` directory exists for a now-disabled package, the script warns but does not delete (operator must explicitly remove via `--prune` flag).

### Versioning

- Pinned by `framework_version` field in the instance's `federation.yaml` (already exists).
- `npm run sync:packages -- --check` reports drift between local package contents and framework's current version.
- `npm run sync:upstream` pulls package updates when operator wants them.

### Lifecycle (in `docs/PACKAGE-LIFECYCLE.md`, new in v3.5)

Mirrors `docs/SKILL-PROMOTION.md` structure:

- **Promotion criteria:** ≥2 instances using a package, parity with skill criteria.
- **Retirement criteria:** zero instances using, ≥6 months dormant.
- **Lifecycle states (new field on `packages-matrix.yaml`):** `active` | `dormant` | `planned` | `retired`.
- **Ownership transfer:** when an instance-originated package gets promoted, framework takes ownership; originating instance becomes a consumer.

### Why not npm publish in v3.5

Npm publishing requires: scoped org setup, CI publishing discipline, semver discipline, deprecation policy. Each is multi-session work. v3.5's budget can't absorb it. Door is explicitly open in `docs/PACKAGE-LIFECYCLE.md` for stable packages to graduate to npm in v3.7+.

---

## 6. One-pager templates

Two artifacts per instance, two template variants per artifact (where it matters). All four files live in `templates/` in the framework, are stripped from instances at clone time, and are rendered into the target by the cloning engine.

### `templates/README.framework.md` and `templates/README.instance.md`

**Common structure (Mustache-style template variables):**

```markdown
# {{ org.name }}{{ #if org.tagline }} — {{ org.tagline }}{{ /if }}

> {{ org.short_description }}

## What this is

[Auto-generated paragraph from SOUL.md mission + IDENTITY.md type]

## Quick navigation

- 🎯 [What is this?](#what-this-is)
- 👥 [Who are you?](#who-are-you)
- 🚀 [Get started](GETTING-STARTED.md)
- 📋 [Current priorities](HEARTBEAT.md)
- 🔗 [All systems map](#systems-map)

## Who are you?

[Role-based jump tables — operator / contributor / visitor / agent]

## Common operations

[Cheatsheet: /initialize, /close, key npm scripts, frequently-used skills]

## Federation

[Pulled from federation.yaml: network, peers, upstream, role]

## Data registries

[Auto-listed from data/*.yaml with one-line descriptions]
```

**Variant differences:**

- **Framework variant** adds:
  - "How to create a new instance" section with `node scripts/clone-framework.mjs` invocation and link to the GitHub Template button
  - "Active downstream instances" pulled from `data/instances.yaml`
  - Skills/packages catalog with promotion candidates

- **Instance variant** adds:
  - "How to sync with framework" section (`npm run sync:upstream`, `framework_version` shown)
  - Governance / treasury / contact blocks (filled when applicable, marked N/A when not)
  - Link back to the framework upstream

### `templates/GETTING-STARTED.md`

Single template, conditional sections by `org.type`. Tone is human, flowy, second-person, conversational. No tables.

```markdown
# Getting started with {{ org.name }}

Welcome. Here's what you'll do in your first 30 minutes.

## 1. Meet your org (5 min)

[Read SOUL.md, IDENTITY.md — what / why / who. One paragraph each, summarized inline.]

## 2. Open your first session (5 min)

Run `/initialize`. The dashboard tells you what's active right now — projects, tasks, who's around, what needs attention.

[Walks through reading the dashboard. Includes a sample render with their org's actual data.]

## 3. Find your role (10 min)

[Conditional based on org.type:]

- **DAO** → governance, voting, treasury patterns
- **Cooperative** → member project applications, governance feedback, decision rationale
- **LocalNode** → bioregional ops, knowledge sharing, peer sync
- **Project / Framework** → skill development, pattern extraction
- **Hub** → federation coordination, cross-org aggregation

## 4. Do your first thing (10 min)

[Suggested first task pulled from HEARTBEAT.md — typically: process your first meeting, log a decision, or add a member.]

## 5. Close cleanly

Run `/close`. Your memory and HEARTBEAT update; commit + push happen automatically.

## When you get stuck

[Common failure modes + fixes — kept living, updated over time.]
```

Length cap: ~400 lines for the rendered output. The template itself with conditionals is ~600 lines.

### Render engine

The cloning engine reads templates from `templates/`, applies a minimal Mustache-style renderer (no logic beyond `{{ var }}` and `{{ #if cond }} ... {{ /if }}`), and writes the rendered output. The renderer is ~80 lines of code; deliberately not a heavy templating library.

---

## 7. Reliability layering

Resolves open questions 1, 4, 5 from `system-reliability.md`.

### Trigger layers

| Layer | When | Checks |
|---|---|---|
| **Pre-commit** (husky-lite shell hook in `.git/hooks/pre-commit`) | Any local commit | `validate:structure` (always, fast); `validate:schemas` (if any `data/*.yaml` touched) |
| **CI** (`.github/workflows/validate.yml`) | Push, PR | Full validator suite: `validate:schemas`, `validate:structure`, `analyze:instances --check-only`, plus `npm run selftest` (which includes a clone-engine dry-run that bootstraps `/tmp/test-instance` and validates it) |
| **Scheduled** (`.github/workflows/drift.yml`) | Weekly cron (Sundays 04:00 UTC) | `analyze:instances`, commits report to `memory/reports/instances-drift-YYYY-MM-DD.md` |
| **Manual** | Operator on demand | `npm run selftest` runs everything explicitly before release |

### Federation SLA

- Instances flagged as **drifted** if `last_sync` > **30 days** ago.
- Instances flagged as **dormant** if `last_sync` > **90 days** ago.
- Drift report (scheduled workflow) groups by status.
- `refi-dao-os` at 7 weeks would currently flag as drifted — appropriate.

### Recovery model

Documented in `docs/RELIABILITY.md` (new in v3.5). Covers:

- **Backup cadence** — git is the backup; commits + pushes are mandatory at `/close`. No external backup needed for the canonical state.
- **Rollback procedure** — `git revert` for surgical fixes; `npm run migrate -- --rollback` for migration-induced issues.
- **Known-good checkpoint discipline** — every release tag (v3.0.0, v3.5.0, ...) is a known-good checkpoint. CHANGELOG.md describes what changed.
- **Data corruption recovery** — `validate:schemas` flags it; `git log -- data/<file>.yaml` finds last good version; revert.
- **Failed sync recovery** — clone engine and sync:packages are idempotent + non-destructive; failures leave inspectable state.

### Self-test surface

`npm run selftest` is the agent runtime smoke test. It is **not** the same as `/initialize`:

- `/initialize` stays fast (< 5s) and tolerant of partial state. It surfaces issues but doesn't gate.
- `npm run selftest` is allowed to be slow (up to 60s). It must exit non-zero on any failure mode the framework promises to catch.

Selftest contents in v3.5:
1. `validate:schemas` (pass)
2. `validate:structure` (pass)
3. `analyze:instances --check-only` (no new drift — framework only)
4. Clone-engine dry-run (`scripts/clone-framework.mjs --target /tmp/test-instance-$$ --type project --non-interactive --config tests/fixtures/instance-config.yaml`)
5. Validate the dry-run target passes its own `validate:*`
6. `version:check` (CHANGELOG up to date with package.json)
7. Cleanup `/tmp/test-instance-$$`

CI runs this on every PR. Operator runs this before tagging a release.

---

## 8. bread-coop-os specifics (the acceptance test)

Built from the 2026-04-23 meeting notes (`260423 Opportunities with Unformal + agents for bread coop.md`) and Luiz's commitment in that meeting to clone the bread-coop-OS template.

### Instance shape

| Field | Value |
|---|---|
| `name` | Bread Cooperative |
| `type` | Cooperative (DAO-adjacent — has voting + governance + member proposals) |
| `id` | `bread-coop-os` |
| `repo` | `https://github.com/luizfernandosg/bread-coop-os` (or whichever account Luiz uses) |
| `local_path` | `../bread-coop-os` (sibling of org-os in `03 Libraries/`) |
| `federation_network` | (none initially — standalone for v3.5) |
| `federation_role` | standalone-instance |
| `framework_version` | `3.5` |
| `agent_runtime` | `["claude-code", "openclaw"]` |
| `packages` (selected) | `dashboard`, `operations`, `regen-agents`, `paperclip-agents-app`, `webapps` |
| `skills` (selected) | All 10 canonical, plus `research` if promoted into framework during v3.5 |
| `data_registries_extra` | `proposals`, `votes`, `member-applications` (governance-specific) |
| `channels` | Telegram (primary), Discourse (forum), Discord (private core team) |
| `notes` | Existing org with active governance. v3.5 MVP scope: clone working, dashboard rendering, meeting processing, governance-aware registries scaffolded. Telegram bot, Unformal surveys, and Ron's project management AI are out-of-tree per-instance work. |

### Acceptance steps

1. `node scripts/clone-framework.mjs --target ../bread-coop-os --type cooperative --interactive`
2. Wizard captures: identity (Bread Cooperative, Cooperative type), Luiz as operator, Telegram + Discourse + Discord channels, packages selection above
3. Selected packages materialized via `npm run sync:packages`
4. `cd ../bread-coop-os && npm install && npm run validate:structure && npm run validate:schemas` — pass
5. Add `bread-coop-os` row to org-os hub's `data/instances.yaml` with the shape above
6. Run `/initialize` in `bread-coop-os` — dashboard renders with org-specific identity (no template strings leaking through)
7. Process the 2026-04-23 meeting notes via `meeting-processor` skill — first decision logged to `bread-coop-os/DECISIONS.md`
8. Run `/close` cleanly — `memory/2026-XX-XX.md` written, commit made, pushed
9. Re-run org-os hub's `npm run analyze:instances` — bread-coop-os shows up, drift = 0

Telegram bot registration is parallel (out-of-tree work), validated as "working" if Luiz can post a message in the Bread Coop Telegram and the bot acknowledges. This is not a release-gating check but is part of the operational acceptance for Luiz personally.

---

## 9. Sequencing (3 phases, ~6 sessions estimated)

```
Phase 1: Foundations (parallelizable, ~2 sessions)
  ├─ Reliability layer    (system-reliability plan execution)
  ├─ Package consumption  (package-integration plan execution)
  └─ One-pager templates  (new — write 4 templates + render engine)

Phase 2: Integration (~2 sessions)
  └─ Cloning engine       (instance-bootstrap plan execution)
       Depends on all of Phase 1
       Includes GitHub Template config + bootstrap-interviewer extension

Phase 3: Acceptance + Release (~2 sessions)
  ├─ bread-coop-os bootstrap (the proof)
  ├─ Other instances re-validated against v3.5 standards
  ├─ Migration script v3.0 → v3.5 (if any breaking changes — likely none)
  ├─ CHANGELOG entry, version bump to 3.5.0, release commit, tag
  └─ /close session writes the release memory entry
```

Phase 1 sub-plans are parallelizable but share the same operator (Luiz, solo). Practical sequencing: reliability first (it's the smallest and unblocks CI for everything else), then package consumption, then templates. Or any order — they don't share files.

Phase 2 cannot start until Phase 1 is complete because the cloning engine consumes templates, package consumption mechanism, and (transitively) the reliability validators that prove the engine's output is good.

Phase 3 cannot start until Phase 2 is complete because bread-coop-os bootstrap IS the engine's first real run.

---

## 10. Verification gates (release checklist)

Each must be checkable to a single `pass / fail` answer.

- [ ] `node scripts/clone-framework.mjs --dry-run` succeeds against a fresh `/tmp/` target
- [ ] Cloning engine produces a passing instance in < 30 min from clean state (timed end-to-end run, including wizard)
- [ ] All 4 templates (`README.framework`, `README.instance`, `GETTING-STARTED`, plus internal partial templates if any) render correctly for a `Cooperative` type instance with no template strings leaking through
- [ ] `npm run selftest` exits 0 on org-os
- [ ] `npm run selftest` exits 0 on `refi-bcn-os` after re-sync
- [ ] `npm run selftest` exits 0 on `refi-dao-os` after re-sync
- [ ] `npm run selftest` exits 0 on `regen-coordination-os` after re-sync (and resolves its current 3 drift items)
- [ ] `npm run selftest` exits 0 on `dao-os` after re-sync
- [ ] Pre-commit hook blocks a deliberate-break commit (manual test: introduce a malformed YAML, attempt commit, confirm block)
- [ ] CI blocks a deliberate-break PR (manual test: open a PR with a malformed YAML, confirm `validate.yml` workflow fails)
- [ ] Scheduled drift workflow runs at least once and writes `memory/reports/instances-drift-*.md`
- [ ] `bread-coop-os` is live, validates clean, dashboard renders, first session logged to its `memory/`
- [ ] `dashboard` package successfully promoted via the new mechanism (used by ≥2 instances after v3.5)
- [ ] `data/instances.yaml` updated to reflect bread-coop-os; org-os hub's `analyze:instances` shows drift = 0 for bread-coop-os
- [ ] `CHANGELOG.md` v3.5.0 entry written
- [ ] `package.json` version bumped to 3.5.0
- [ ] Tag `v3.5.0` pushed publicly (this time, unlike v3.0.0 which was kept local)

---

## 11. Out of scope (explicit non-goals)

These will likely be raised; v3.5 explicitly does not address them.

- **Survey integration** (Unformal — Jonas's work, not org-os)
- **Telegram bot implementation** (org-os ships skills/integration patterns; the bot itself is out-of-tree per-instance)
- **Ron's project management AI integration** (separate, future package candidate; may surface as a skill in v3.6+)
- **npm publishing of any framework packages** (Phase D of `package-integration`, deferred to v3.7+)
- **Federation end-to-end test** (`federation-protocol` plan, deferred to v3.6+)
- **Multi-level access control / privacy filtering** (raised in the bread-coop meeting; needs its own scoping plan, not v3.5)
- **Web bootstrap wizard** (`non-tech-onboarding`, deferred to v3.6 immediately after Obsidian work)
- **Obsidian as primary operator interface** (deferred to v3.6 — first thing after v3.5 ships)
- **TUI dashboard** (deferred to v3.7; agent-rendered ASCII is sufficient for v3.5)
- **Migration tooling for breaking changes between v3.0 and v3.5** (needed only if v3.5 introduces breaking changes; current design is additive)

---

## 12. Risks and mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Cloning engine takes longer than 2 sessions because of edge cases (existing instances vs. fresh clones) | Medium | Engine is single-direction (framework → new instance); existing instances are not migrated by this script — they're updated by `sync:upstream`. Keep the surface narrow. |
| `bread-coop-os` reveals a Cooperative-type assumption gap | Medium | Use bread-coop-os as the test in Phase 3; if a gap surfaces, fix the engine and re-bootstrap rather than patching the instance manually. |
| GitHub Template wrapping turns out to be brittle (postinstall hooks fail across platforms) | Low-Medium | CLI path is the primary release-blocker; GitHub Template is best-effort in v3.5, fully polished in v3.6 with `non-tech-onboarding`. |
| Pre-commit hook annoys operator and gets `--no-verify`'d into uselessness | Medium | Hook is fast (target < 1s for the structure check). If it gets slow, optimize before adding more checks. Document the `--no-verify` escape valve clearly so it stays exceptional. |
| CI on every PR turns out to be too slow on cold runners | Low | Only run validator suite on touch of relevant paths (`data/`, `scripts/`, `templates/`). Selftest's clone-engine dry-run is the slow part — gate behind a label if needed. |
| Reliability layer surfaces accumulated drift in production instances that's expensive to fix all at once | Medium-High | Phase 3 includes "re-validate other instances" — budget 1 session for fixing the surfaced issues. If it explodes, scope-cut: bread-coop-os + org-os pass; others get warnings, fixed in v3.6. |
| Package consumption mechanism conflicts with how instances already manage `packages/` | Low-Medium | The script is non-destructive (won't delete a local package without `--prune`). Audit step in Phase 1 catches conflicts before they happen. |

---

## 13. Migration from v3.0 (if applicable)

Current design is **additive**. New files added (`templates/`, `docs/PACKAGE-LIFECYCLE.md`, `docs/RELIABILITY.md`, `scripts/clone-framework.mjs`, `scripts/sync-packages.mjs`, `.github/workflows/*`); existing files extended but not broken.

If during implementation a breaking change surfaces (e.g., schema field rename in `federation.yaml`), a migration is added at `scripts/migrations/v3-to-v3-5-*.mjs` following the same pattern as `v2-to-v3-workstream-frontmatter.mjs`. Each downstream instance gets a flagged-as-needed migration on next sync.

If the design holds additive, the version bump from 3.0.0 to 3.5.0 reflects new capability, not breaking change. Operators on v3.0 can update at their own pace.

---

## 14. Post-v3.5 trajectory (context, not commitment)

Immediate follow-ups (v3.6, expected within 4–6 weeks of v3.5):
- `obsidian-interface` — Obsidian as primary steady-state operator interface
- `obsidian-canvas-interface` — Canvas as visual layer
- `non-tech-onboarding` — web wrapper over the v3.5 cloning engine (`npm create org-os@latest` + GitHub Pages bootstrap form)

Longer horizon (v3.7+):
- `tui-dashboard` — Ink-based interactive TUI (impl plan ready)
- `framework-dashboard-template` → web dashboard as thin renderer over `tui-data`
- `federation-protocol` end-to-end test
- `future-instance-specs` for any new instance types raised by then
- Selective npm publishing of stable framework packages (`dashboard`, `operations`)

---

## 15. References

### Source plans (in this repo)

- `docs/agent-plans/instance-bootstrap.md`
- `docs/agent-plans/package-integration.md`
- `docs/agent-plans/system-reliability.md`
- `docs/agent-plans/non-tech-onboarding.md` (deferred)
- `docs/agent-plans/obsidian-interface.md` (deferred to v3.6)
- `docs/agent-plans/obsidian-canvas-interface.md` (deferred to v3.6)
- `docs/agent-plans/tui-dashboard.md` (deferred to v3.7)
- `docs/agent-plans/framework-dashboard-template.md` (deferred)
- `docs/agent-plans/federation-protocol.md` (deferred to v3.6+)
- `docs/agent-plans/future-instance-specs.md` (deferred)
- `docs/agent-plans/QUEUE.md` (pipeline)
- `docs/agent-plans/versioning-system.md` (completed; provides version + migration infrastructure)

### Bootstrap reference

- `BOOTSTRAP.md` (current prose; will be rewritten in Phase 2 to point at the new mechanism)
- `scripts/setup-org-os.mjs` (existing wizard for already-cloned repo; will be folded into the new engine)
- `skills/bootstrap-interviewer/SKILL.md` (will be extended with package + skill selection)

### Framework conventions

- `docs/FILE-STRUCTURE.md`
- `docs/DATA-MODEL.md`
- `docs/SKILL-PROMOTION.md` (template for the new `PACKAGE-LIFECYCLE.md`)
- `docs/VERSIONING.md`

### bread-coop-os context

- `/Users/luizfernando/Desktop/Workspaces/Zettelkasten/260423 Opportunities with Unformal + agents for bread coop.md` — meeting notes with Luiz's commitment to clone bread-coop-OS template

### v3.0 release context

- `memory/2026-04-24.md` — self-hosting inauguration session
- `CHANGELOG.md` — v3.0.0 entry

---

## 16. Decision log for this design

Captured during the 2026-04-25 brainstorming session:

| # | Question | Choice | Rationale |
|---|---|---|---|
| 1 | v3.5 ready-bar | Bundle B (cloning + reliability + packages, with Obsidian queued for v3.6) | "Fully ready for orgs" without enforced reliability means silent rot; without package consumption means promotion is a slogan. TUI is too much for one release. |
| 2 | One-pager artifact | A + B (README replaces v1 outdated one + new GETTING-STARTED.md, more flowy/human) | One source of truth (README) plus a streamlined operator intro. |
| 3 | One-pager templating | X (same template shape, framework + instance variants) | Two templates; instances generated at clone time; one source of truth in `templates/`. |
| 4 | Cloning mechanism | D, ship C + A in v3.5 (engine = `scripts/clone-framework.mjs`, GitHub Template wrapping; `npm create` deferred) | Engine built once, reused by all paths. Defer npm scaffolder to `non-tech-onboarding`. |
| 5 | Package consumption | A (vendored, sync-pulled, pin by framework_version) | Formalizes existing informal practice. npm publishing is a v3.7+ concern. |
| 6 | bread-coop-os role | A (hard gate) | Luiz committed to cloning it in 2026-04-23 meeting; v3.5's job is to make that bootstrap clean and reproducible. |
| 7 | Reliability self-test surface | `npm run selftest` (separate from `/initialize`) | `/initialize` stays fast and tolerant; selftest is the gate, allowed to be slow. |
| 8 | Federation SLA | 30 days drifted, 90 days dormant | Catches `refi-dao-os` (currently 7 weeks) appropriately. |

---

_End of release design._
