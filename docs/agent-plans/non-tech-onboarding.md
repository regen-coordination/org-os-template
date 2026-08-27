---
id: non-tech-onboarding
title: "Non-Tech Operator Onboarding"
status: frozen
priority: null
scope: framework
depends_on: [future-instance-specs, instance-bootstrap]
created: 2026-04-06
started: null
completed: null
estimated_sessions: null
tags: [v2, accessibility, onboarding]
workstream: non-tech-onboarding
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 6-adjacent; OPERATOR-GUIDE Level 2 promise is not built (clean-room finding M2). Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Enable non-technical operators to bootstrap and interact with org-os without GitHub/CLI knowledge. Progressive disclosure: chat → web dashboard → guided bootstrap → CLI.

## Open Questions

- Which platform for the web wizard? (GitHub Pages static form → Actions backend? Separate hosted service?)
- How to handle authentication for member-level actions on webapps?
- Should the Telegram bot interface be standardized at framework level or remain instance-specific?

## Rough Tasks

- [ ] Write `docs/OPERATOR-GUIDE.md` — what you can do via chat, web, CLI
- [ ] Write `docs/CHAT-INTERFACE.md` — Telegram/chat bot interface spec
- [ ] Design web bootstrap wizard flow (maps to bootstrap-interviewer questions)
- [ ] Add `deploy:pages` config to all webapp packages (GitHub Pages ready)
- [ ] Add shared navigation header across dashboard, ideation-board, aggregator
- [ ] Add "Getting Started" section to README.md template for non-tech users
