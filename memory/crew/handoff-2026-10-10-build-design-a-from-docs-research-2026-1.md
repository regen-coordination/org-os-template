---
id: handoff-2026-10-10-build-design-a-from-docs-research-2026-1
from: 2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor
to_role: engineer
branch: crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor
status: open
created: '2026-10-10T23:48:39-03:00'
updated: '2026-10-10T23:48:39-03:00'
taken_by: null
---
## Brief

Build design A from docs/research/2026-10-10-herdr-one-crew-workspace.md (Recommendation). DO NOT START until the lead confirms the operator agreed that a released agent may stay alive with its working directory deleted; it changes spec 5.2. Then: (1) in release, remove the worktree with git and never call herdr worktree remove; (2) after the pane exists at seat, call herdr pane report-metadata and workspace report-metadata with role and assignment tokens, never failing the seat; (3) update spec 5.2 and docs/CREW.md (the optional [ui.sidebar.agents] row is the operator's own config edit). Check each as listed in the note.
