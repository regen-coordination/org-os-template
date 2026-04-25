# MEMORY.md — Organizational Memory Index

_Lightweight index for persistent organizational memory. Detailed notes live in `memory/YYYY-MM-DD.md` as dated entries. Update when key decisions are made._

---

## Quick Index

- **Identity:** `IDENTITY.md` (org-os framework + orchestration hub)
- **Values:** `SOUL.md`
- **Operator:** `USER.md` (Luiz Fernando, solo maintainer)
- **Mandate:** `MASTERPLAN.md` (v2.0.0)
- **Decisions log:** `DECISIONS.md` (authoritative — what was decided and why)
- **Active Tasks:** `HEARTBEAT.md`
- **Session notes:** `memory/YYYY-MM-DD.md`
- **Members:** `data/members.yaml`
- **Workstreams:** `data/projects.yaml`
- **Instances (framework-only):** `data/instances.yaml`
- **Skills catalog:** `data/skills-matrix.yaml`
- **Packages catalog:** `data/packages-matrix.yaml`
- **Queued plans:** `docs/agent-plans/QUEUE.md`
- **Federation:** `federation.yaml`

---

## Key Decisions

→ See `DECISIONS.md` for the authoritative chronological log with full rationale and refs. New decisions are appended there, not here. This file (`MEMORY.md`) is the index over org memory; `DECISIONS.md` is the decision record.

---

## Active Context

- **[ongoing]** `instance-orchestration` workstream — build drift monitoring, skill-promotion pipeline.
- **[ongoing]** `federation-protocol` workstream — end-to-end sync exchange testing.
- **[ongoing]** Multi-instance skill promotion review — `research` skill (2 instances), DAO modules (dao-os only).
- **[ongoing]** Solo-maintainer phase — no treasury, no formal governance; adjust when first external contributor lands.

---

## Organizational History

- **[2026-04-05]** org-os v2.0.0 framework published — 13 registries, 10 skills, EIP-4824 compliance
- **[2026-04-24]** Self-hosting inauguration — framework repo becomes live instance
- _(Future milestones: first external contributor, first promoted skill, first DAO-phase trigger)_

---

## Relationship Map

### Upstream
- **(self-referential at framework layer)** — `github.com/regen-coordination/org-os-template` is the template; this repo IS the template.

### Downstream (instances)
- **refi-bcn-os** — LocalNode (ReFi Barcelona, cooperative-in-formation). Production.
- **refi-dao-os** — DAO (global ReFi coordination). Production, Phase 2.
- **dao-os** — Project (DAO-module development platform). Beta.
- **openclaw** — Agent runtime container. Alpha.
- **regen-coordination-os** — Hub. Remote-only, not locally cloned.

### Network Peers (related repos)
- **ReFi-Barcelona** — knowledge base for refi-bcn-os
- **ReFi-BCN-Website** — public site
- **Regenerant-Catalunya** — flagship program
- **Local-ReFi-Toolkit** — local node toolkit
- **organizational-os-framework** — upstream sibling
- **organizational-os** — upstream coordination

### Integrations
- **OPAL** — meeting transcript → schema extraction (at `integrations/opal/`, production-ready, pending rollout to instances)

---

_This file is read on every agent session. Keep it current. Write detailed session notes to `memory/YYYY-MM-DD.md`._
