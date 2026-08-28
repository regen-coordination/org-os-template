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
- **[2026-04-25]** `multica-integration` spec + 25-task plan committed, execution deferred. Pilots the self-installing package pattern for the queued `package-integration` Phase 3. See `docs/superpowers/specs/2026-04-25-multica-integration-design.md` and `docs/superpowers/plans/2026-04-25-multica-integration.md`.
- **[2026-04-29]** New downstream instance scaffolded: `refi-med-os` (ReFi Mediterranean, LocalNode, alpha). Federated under the `refi-dao` network as a peer of refi-bcn-os and refi-dao-os. Hosted at `ReFiDAO/refi-med-os` (public). Public website + knowledge base (`ReFiDAO/ReFi-Mediterranean`) consolidated at `repos/refi-mediterranean/`. Instance is in pre-bootstrap state — operator runs `bootstrap-interviewer` from a one-pager. See `memory/2026-04-29.md`.
- **[2026-08-02]** **Federation map ("the torch") shipped** — the federation layer got a face. New package `@org-os/federation-map`: a framework-agnostic `<federation-map>` web component rendering an instance's *external* world as rings by hop-distance (ring 1 federated instances · ring 2 frontier peers-of-peers · ring 3 sources/ecosystems), deliberately the counterpart to the internal note graph — two linked views joined by explicit portals, not one blended space. Data plane stays in `org-os-kms` (`render map`, `federate frontier`, `render map html`); the component never reads YAML. Three surfaces: site `/federation` + home mini, and a self-contained offline vault artifact openable in Obsidian. Frontier discovery fetches each peer's own `federation.yaml` one hop out, so unexplored territory renders as dim embers — the dark-forest torch. Final review caught and closed a Critical XSS where remote peer-manifest fields reached the panel via raw `innerHTML`. Spec: `docs/superpowers/specs/2026-07-19-federation-map-design.md` · `memory/2026-08-02.md`.
- **[2026-05-03]** `autopoiesis-research` workstream initiated and Phase 1 complete. Two-level autopoietic frame for org-os (instance-primary, framework-secondary), 9-aspect × 2-level matrix, 3-phase plan (concept → framework-level pilot → decisions cascade). Phase 1 gate selected Loop C (cascade closure) over default Loop A; closing edge = `scripts/sync-upstream.mjs` + `scripts/validate-identity.mjs` + `federation.yaml.metadata.{genesis_commit,last_sync_commit}` lineage stamps. Phase 2 plan replanned. Spec: `docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md`. Synthesis: `docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md`.

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
- **refi-med-os** — LocalNode (ReFi Mediterranean, Mediterranean bioregion). Alpha — bootstrap pending.
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
