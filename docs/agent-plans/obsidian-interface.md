---
id: obsidian-interface
title: "Obsidian as Primary Operator Interface"
status: scoping
priority: null
scope: framework
depends_on: []
created: 2026-04-24
started: null
completed: null
estimated_sessions: null
tags: [interface, obsidian, operator-ux, packages]
workstream: operator-interfaces
---

## Goal

Make Obsidian the primary, full-featured interface through which a human operator runs, observes, and collaborates on an org-os instance. The workspace is already an Obsidian vault — lean into it rather than fight it.

## Why

- Org-os is designed agent-first but operators still spend most of their time reading, writing, and navigating files. Obsidian is where that happens.
- The non-tech-onboarding plan addresses *bootstrap* (a web wizard). This plan addresses *ongoing operation* — a different UX problem.
- Canvas (separate plan, depends on this) extends the interface into visual/topological territory.

## Output shape (proposal)

A new framework package: **`packages/obsidian-interface/`** — contains:
- A vault-level `.obsidian/` config with recommended plugins, hotkeys, and workspace layout.
- Dataview / Bases queries that surface HEARTBEAT tasks, projects, ideas, instances, federation, skill candidates — each rendered in a dedicated note.
- Note templates (Templater or plain) for meeting notes, memory entries, plan scoping, skill promotion.
- Styling (CSS snippets) that matches the dashboard visual language.
- An install script (`npm run setup:obsidian`) that symlinks or copies the config into the active vault.

## Open questions (to resolve before moving to queued)

1. **Scope per role** — does a `maintainer` see different views than a `contributor`? Or is it one unified layout that adapts via property filters?
2. **Plugins: required vs recommended** — hard dependencies (Dataview, Bases) vs optional (Templater, Kanban, Canvas). What's the minimum viable set?
3. **Read-only vs read-write** — should Obsidian notes write back to `data/*.yaml`? Or are YAML files authoritative and Obsidian is a view layer only? (Biggest decision.)
4. **Bidirectional sync with agent output** — when the agent updates `HEARTBEAT.md`, the Obsidian view should reflect immediately. Is that automatic (file watcher) or manual (reload)?
5. **Multi-instance workflow** — the user operates in 3+ vaults simultaneously (hub, refi-bcn, refi-dao). Do they share a plugin set? Is there a meta-vault that orchestrates?
6. **Integration with slash commands** — can `/initialize` render into an Obsidian pane rather than terminal? Via what bridge?
7. **Mobile / tablet** — is Obsidian mobile in scope or desktop-only?

## Related plans

- **`obsidian-canvas-interface`** (next) — Canvas as visual layer on top of this.
- **`non-tech-onboarding`** (scoping) — the web-wizard entry point, complementary to Obsidian as the steady-state interface.
- **`framework-dashboard-template`** (scoping) — the web dashboard package; decide if Obsidian replaces it or runs alongside.

## Tasks (preliminary, will firm up when moving to queued)

- [ ] Answer open questions above (one session)
- [ ] Spec `packages/obsidian-interface/` structure
- [ ] Draft Dataview/Bases queries for each core registry
- [ ] Draft note templates (meeting, memory, plan)
- [ ] Test in this repo's vault
- [ ] Document install flow for new instances
- [ ] Update `BOOTSTRAP.md` Phase 2 to reference Obsidian setup

## Out of scope

- Obsidian Publish or web-published vault — separate concern.
- Replacing the CLI / agent runtime. Obsidian is the *operator* interface; agents still run via Claude Code / openclaw.
