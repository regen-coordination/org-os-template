# IDENTITY.md — Organizational Identity

_Bridges agent identity with EIP-4824 organizational identity. This file describes **org-os itself** — the framework repo, not a downstream instance._

---

## Core Identity

- **Name:** org-os
- **Type:** Project
- **Sub-role:** Framework + orchestration hub
- **Emoji:** 🧬
- **Short description:** Shared operating system for a federation of regenerative organizations — template + standards + orchestration hub.

_Trajectory: **solo-maintainer** today → **open-source project** as contributors land → **DAO/collective stewardship** if treasury forms. Governance/treasury fields below are intentionally empty in the solo phase; they fill in as the project evolves._

---

## Orchestration Role

org-os is a framework **and** a multi-instance orchestration hub. It:

- Provides the canonical template (data model, file structure, skills, schemas) forked by all instances.
- Tracks live state of every downstream instance in `data/instances.yaml`.
- Catalogs cross-instance skills and packages in `data/skills-matrix.yaml` and `data/packages-matrix.yaml`.
- Runs `npm run analyze:instances` to detect drift from framework standards.
- Surfaces promotion candidates (skills/patterns proven in ≥2 instances, ready for framework-canonical status).

Known downstream instances: `refi-bcn-os`, `refi-dao-os`, `dao-os`, `openclaw`, `regen-coordination-os` (see `federation.yaml` → `downstream`).

---

## On-Chain Identity

- **daoURI:** N/A (solo phase — no on-chain registration)
- **Primary Chain:** N/A (solo phase)
- **Registration Contract:** N/A (solo phase)

---

## Treasury

- **Primary Safe:** N/A (solo phase — no treasury)
- **Operational Wallet:** N/A (solo phase)
- **Additional Addresses:** —

---

## Governance Infrastructure

- **Hats Protocol Tree ID:** N/A (solo phase)
- **Gardens DAO:** N/A (solo phase)
- **Snapshot Space:** N/A (solo phase)
- **Karma Gap:** N/A (solo phase)
- **Decision Model:** solo-maintainer

---

## Federation Identity

- **Network:** regen-coordination
- **Node ID:** org-os
- **Hub Role:** framework-upstream + orchestration-hub
- **Upstream:** github.com/regen-coordination/org-os-template (this repo — self-referential at framework layer)

---

## Contact

- **GitHub:** github.com/regen-coordination/org-os-template
- **Maintainer:** Luiz Fernando (github.com/luizfernandosg)
- **Telegram:** N/A (no public channel yet)
- **Website:** N/A
- **Email:** N/A (use GitHub Issues)

---

## Evolution Triggers

How this file changes as the project grows:

- **Solo → OSS** — trigger: first external contributor lands a merged PR.
  - Update `governance.Decision Model` → `stewards-council-candidate`
  - Add contributors to `data/members.yaml`
  - Populate `governance.Snapshot Space` if proposals start being run publicly
- **OSS → DAO** — trigger: treasury forms (grant received, contributor stipends begin).
  - Populate `On-Chain Identity.daoURI`, `Treasury.Primary Safe`
  - Populate `Governance Infrastructure.Hats Protocol Tree ID`, `Gardens DAO`
  - Begin logging grant inflows in `data/finances.yaml`
- **Framework-hub evolution** — when downstream instances exceed ~10, promote `data/instances.yaml` to a public federation registry (publish via `.well-known/instances.json`).

---

_This file is read by agents at session startup to ground their understanding of who they are operating as. Keep it current as the organization evolves._
