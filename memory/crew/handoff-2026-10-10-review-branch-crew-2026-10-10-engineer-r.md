---
id: handoff-2026-10-10-review-branch-crew-2026-10-10-engineer-r
from: 2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
to_role: reviewer
branch: crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
status: taken
created: '2026-10-10T23:41:20-03:00'
updated: '2026-10-10T23:41:59-03:00'
taken_by: 2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before
---
## Brief

Review branch crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with (three commits on feat/crew a46e3b4: part A herdr codes and pane look, part B review findings F1-F4, part C --base over a handoff branch). Report is in the assignment file. Run npm ci --ignore-scripts, node --test "tests/scripts/crew-*.test.mjs" (expect 151 pass) and node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs (expect 25 pass). Judge: whether each new test fails on a46e3b4; the retry/look logic in scripts/crew/herdr.mjs against spec 5.3 items 7-12 (can any path send a second agent start?); that core.mjs stays pure; the bare-shell-ready case; docs matching the code.
