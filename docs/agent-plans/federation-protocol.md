---
id: federation-protocol
title: "End-to-End Federation Exchange"
status: queued
priority: 2
scope: framework
depends_on: [v2-phase1-framework]
created: 2026-04-06
started: null
completed: null
estimated_sessions: 2
tags: [v2, federation, phase4]
workstream: federation-protocol
---

## Goal

Test and verify federation exchange works end-to-end between refi-dao-os and refi-bcn-os. Document the protocol with concrete examples.

## Tasks

- [ ] Verify both instances have complete `knowledge-manifest.yaml` with published domains
- [ ] Test knowledge exchange: refi-dao-os publishes → refi-bcn-os receives
- [ ] Test knowledge exchange: refi-bcn-os publishes → refi-dao-os receives
- [ ] Test `.well-known/` discovery between instances
- [ ] Verify dashboard shows accurate federation data
- [ ] Document exchange protocol with concrete curl/fetch examples in `docs/FEDERATION.md`
- [ ] Test skill sharing: promote a custom skill from instance → framework

## Verification
- [ ] Both dashboards show federation peers with current data
- [ ] Knowledge exchange log populated in both instances
- [ ] ECOSYSTEM-MAP.md reflects tested federation links
