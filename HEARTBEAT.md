# HEARTBEAT.md — Active Monitoring

_Living checklist of active tasks and system health. Agents consult on every session. Update regularly — mark done, add new, remove stale._

---

## Active Tasks

### v3.6 — Operator Interfaces

- [ ] **obsidian-interface** — Obsidian as primary operator interface (top priority for v3.6)
- [ ] **obsidian-canvas-interface** — Canvas as system overview + interface (scoping, depends on obsidian-interface)
- [ ] **non-tech-onboarding** — Web wrapper over the v3.5 cloning engine (queued)

### Technical
- [ ] Complete `federation-protocol` end-to-end sync test (deferred to v3.7)
- [ ] Write `future-instance-specs` for regen-coordination-os and regen-toolkit (deferred to v3.7)
- [ ] Run `npm run generate:schemas` after any `data/` edit

### Orchestration (multi-instance)
- [ ] Weekly: run `npm run analyze:instances` and review drift report
- [ ] Review skill-promotion candidates (see `data/skills-matrix.yaml` where `promotion_status: candidate`)
  - `research` — present in refi-bcn-os and refi-dao-os; promote to framework
  - `safe-treasury`, `hats-governance`, `gardens-governance`, `karma-reputation`, `eip4824-identity` — DAO modules in dao-os; evaluate for framework
- [ ] Resolve `regen-coordination-os` locally — listed in `repos.manifest.json` but not cloned

### Funding
- N/A (solo phase — no treasury, no active funding applications)

### Governance
- N/A (solo phase — solo-maintainer decision model)

### Operations
- N/A (solo phase — no formal meetings)

---

## System Health

### Agent Runtime
- [x] Verify `/initialize` renders real content (no stub placeholders) — verified 2026-04-25, v3.5
- [x] Verify `scripts/initialize.mjs` emits valid JSON with populated registries — verified 2026-04-25, v3.5

### Data Integrity
- [ ] `data/members.yaml` is up to date
- [x] `data/projects.yaml` reflects current workstreams — updated 2026-04-25 for v3.5 closeout
- [x] `data/instances.yaml` reflects current instance state — bread-coop-os added 2026-04-25
- [ ] `.well-known/*.json` matches current `data/`

### Federation
- [x] `federation.yaml` `downstream` lists all 5 known instances — verified 2026-04-25
- [ ] Instance sync review performed in last 7 days (`memory/reports/instances-drift-*.md`)

### Release
- [x] Push `v3.5.0` tag to origin — deferred to operator (out of scope for autonomous)
- [ ] Edit `CHANGELOG.md` `[Unreleased]` stub before the next `npm run version:update`
- [ ] Apply v3.5 migration notes to each downstream instance on their next sync session

---

## Reminders

- [ ] After any `data/` change → `npm run generate:schemas && npm run validate:schemas`
- [ ] After any `federation.yaml` change → `npm run validate:structure`
- [ ] Log key decisions to `DECISIONS.md` (authoritative decisions log)
- [ ] Write detailed session notes to `memory/YYYY-MM-DD.md`

---

## Recently Completed

_(Move completed items here with date — keep for 30 days then remove)_

- [2026-04-25] **v3.5.0 RELEASED** — "Ready for Real Orgs" — cloning engine, package consumption, reliability layer, one-pager templates, bread-coop-os live
- [2026-04-25] `package-integration`, `reliability`, `instance-bootstrap` workstreams completed and archived
- [2026-04-25] Three new workstreams scoped and queued for v3.6 — `obsidian-interface`, `obsidian-canvas-interface`, `non-tech-onboarding`
- [2026-04-25] Verified `/initialize` renders real content (no stubs) and `scripts/initialize.mjs` emits valid JSON
- [2026-04-24] Versioning system — policy, CHANGELOG, migrations, version-consistency validator, v3.0.0 bump
- [2026-04-24] Self-hosting inauguration — stubs filled, instance registry introduced, all 5 instances mapped
- [2026-04-06] v2.0.0 Phase 1 framework — docs, skills, data model, session lifecycle

---

_Last updated: 2026-04-25_
