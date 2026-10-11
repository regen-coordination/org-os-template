---
id: handoff-2026-10-10-review-branch-crew-2026-10-10-engineer-o
from: 2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo
to_role: reviewer
branch: crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo
status: taken
created: '2026-10-10T23:25:41-03:00'
updated: '2026-10-10T23:26:20-03:00'
taken_by: 2026-10-10-reviewer-review-the-follow-up-and-onboarding-stac
---
## Brief

Review branch crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo together with the branch under it, crew/2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r (both unmerged, on top of feat/crew). My change: the first prompt and nudge point every seat at a "Before you begin" section of roles/README.md (MASTERPLAN.md, SOUL.md, MEMORY.md); lead adds HEARTBEAT.md and the AGENTS.md startup sequence; crew checks nothing. Check: the prompt stays one line, the README section is true for a fresh instance (files exist but are stubs), tests in crew-seat and crew-shipped-roles fail on the base. Run: node --test "tests/scripts/crew-*.test.mjs"
