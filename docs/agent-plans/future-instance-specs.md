---
id: future-instance-specs
title: "Write Specs for regen-coordination-os and regen-toolkit"
status: queued
priority: 1
scope: framework
depends_on: [v2-phase1-framework]
created: 2026-04-06
started: null
completed: null
estimated_sessions: 1-2
tags: [v2, specs, phase3]
workstream: framework-evolution
---

## Goal

Write detailed specification documents for two future org-os instances that haven't been initialized yet. These specs define what each instance needs when scaffolded.

## Tasks

### regen-coordination-os (Hub Node)
- [ ] Write `docs/SPEC-REGEN-COORDINATION-OS.md`:
  - Type: Hub (federation coordinator)
  - Aggregates all federated node data
  - Coordinates cross-org knowledge sync
  - Packages: aggregator, knowledge-exchange, dashboard, coordination
  - Custom data: `data/nodes.yaml` (registry of all local nodes)
- [ ] Define MASTERPLAN.md template — hub coordination mandate
- [ ] Define SOUL.md template — values: network weaving, pluralism, subsidiarity
- [ ] Spec unique skills: node-coordinator, federation-sync, cross-org-aggregator
- [ ] Spec agent modes: network-facilitator, knowledge-aggregator

### regen-toolkit (Resource Library)
- [ ] Write `docs/SPEC-REGEN-TOOLKIT.md`:
  - Type: Resource library
  - Curates regenerative finance knowledge
  - Packages: aggregator, knowledge-exchange
  - Custom data: `data/tracks.yaml`, `data/modules.yaml`
- [ ] Define MASTERPLAN.md template — toolkit curation mandate
- [ ] Define SOUL.md template — values: open knowledge, practical tools, accessibility
- [ ] Spec unique skills: content-curator, gap-analyzer, module-tracker
- [ ] Spec agent modes: toolkit-curator

## Verification
- [ ] Each spec is self-contained enough to bootstrap the instance from scratch
- [ ] Specs reference canonical file structure and data model
