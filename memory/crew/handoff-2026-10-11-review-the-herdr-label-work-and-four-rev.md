---
id: handoff-2026-10-11-review-the-herdr-label-work-and-four-rev
from: 2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
to_role: reviewer
branch: crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
status: taken
created: '2026-10-11T00:23:29-03:00'
updated: '2026-10-11T00:24:41-03:00'
taken_by: 2026-10-11-reviewer-review-the-herdr-labels-and-four-review
---
## Brief

Review the herdr label work and four review items on this branch (two commits over f287105: 7488b3e labels, 02a33e3 four items). Read my report in my assignment file first for what I claim; then check the code, not the report. Check especially: (1) that a label refusal can never fail a seat, change a record or hide a report; (2) the F-1 release flow with a stub: first release, then worktree appears, then second release, and again with nothing appearing; (3) the spec section 8 example equals renderBoard output; (4) that the DECISIONS.md bullet guard really fails when the bullet is removed; (5) the docs/CREW.md config lines against herdr's configuration reference, which I could only read at the v0.9.1 tag. Run: node --test "tests/scripts/crew-*.test.mjs", node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs, npm run version:check. Do not run report-metadata against the live herdr.
