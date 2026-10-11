---
id: handoff-2026-10-11-review-the-herdr-label-call-fix-id-befor
from: 2026-10-11-engineer-the-live-herdr-refuses-crew-s-label-call
to_role: reviewer
branch: crew/2026-10-11-engineer-the-live-herdr-refuses-crew-s-label-call
status: taken
created: '2026-10-11T00:47:04-03:00'
updated: '2026-10-11T00:47:51-03:00'
taken_by: 2026-10-11-reviewer-review-the-label-call-fix-and-the-change
---
## Brief

Review the herdr label-call fix (id before --source) and the release change that looks inside folded ignored directories for node_modules; two commits on fa61f54. Check git.mjs changes() against real git, including NUL parsing, and whether the brief's 'only root node_modules' premise was right.
