---
id: 2026-10-10-engineer-crew-command-edges-plain-errors-honest-p
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p
detached: false
pane: 'wQ:p1'
workspace: wQ
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:08:22-03:00'
updated: '2026-10-10T21:13:23-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Crew command edges: plain errors, honest prompt wording, lead commands, hung herdr, conflict copies, manifest

Goal. Seven known minor defects at the edges of crew make an operator or an agent meet a raw error, a wrong instruction or a hang. Fix each one test-first (a test that fails on the old code) where a test is possible. You own: seat, nudge and assignmentBody in scripts/crew/core.mjs; the seat and report cases and USAGE in scripts/crew.mjs; scripts/crew/herdr.mjs; scripts/crew/trail.mjs; modules/org-os-crew/module.yaml. Another engineer is working at the same time on release, board and renderBoard in core.mjs and the release and board cases in crew.mjs: do not edit those, so the two branches merge cleanly. If you need a change there, say so in your report.

The defects (numbers are the operator's).
4. `report --file <missing file>` prints a raw file-system error and a stack. It should print one plain sentence saying the file could not be read and exit 1.
5. When the first prompt was attempted but herdr timed out or failed, seat records prompted: false and the seat command recommends `nudge`, which resends. Spec section 10 says the launcher never resends, because a timeout does not prove non-delivery. Lead's decision: keep two cases apart. (a) agent_not_ready at start: the prompt was never sent; prompted: false; nudge is right, as today. (b) the prompt was attempted and herdr did not confirm it: record that distinctly (for example prompted: 'unconfirmed'; you choose the representation, but old trail files with true/false must keep working), nudge must refuse it with a sentence explaining why, and the seat command must say honestly that the prompt may or may not have arrived, tell the operator to look at the agent's pane, and give them what to type there if it did not (the role file and assignment file paths). If reading the code you find this decision wrong, say so in your report rather than silently doing otherwise.
6. A brief whose first character is a dash is parsed as an option and gives a usage error, and USAGE does not say so. Check whether putting `--` before the brief works with node:util parseArgs as used here; if it does, say that in USAGE (for seat and handoff) and in the error; if it does not, make it work or say what does.
7. herdr subprocess calls in scripts/crew/herdr.mjs have no timeout, so a hung herdr hangs the command. Add a timeout and turn it into a HerdrError with its own code and a plain message. Take care with `agent prompt`: a timeout there is case 5(b), not a failure of seating. herdr.mjs is not unit-tested by design (spec section 13); if you can make the timeout testable without calling the real herdr (for example by letting the binary name or the timeout be passed in), do; if not, say what you verified by hand.
8. A sync-conflict copy of a trail file (a name containing `.sync-conflict-`, made by Syncthing when the vault is synced) is read by readTrail as a second assignment or handoff. It should not count as a record. Decide whether it is skipped silently or listed so the operator sees it, and say why; do not delete it.
9. modules/org-os-crew/module.yaml does not list the crew tests although spec section 12 says the module owns tests/scripts/crew-*.test.mjs (check whether any fixtures the crew tests use need listing too). See how other modules list tests and what tests/scripts/module-manifests.test.mjs and tests/clone-manifest.txt expect.
10. A role that may seat (the lead) gets an assignment file whose Commands section lists only report and handoff. The lead also needs seat, release, nudge, handoff-close and board, by the main checkout's absolute script path, because `npm run crew` from its own worktree is refused. For roles with may_seat: true, assignmentBody should list those commands too, in the same style, and say that the base branch must be passed with --base when the code to work on is not on main. Roles that may not seat must not be shown them.

Already known. Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md, sections 5, 6, 7, 10, 12, 13. Tests with fake adapters to extend: tests/scripts/crew-seat.test.mjs, crew-trail.test.mjs, crew-cli.test.mjs, crew-flow.test.mjs. Operator-facing text: docs/CREW.md and skills/crew/SKILL.md; update only the sentences your change makes untrue. Do not add a dependency.

Done means. Each item has a test that failed before your change and passes after, or a stated reason why it cannot have one; `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs` pass (run `npm ci --ignore-scripts` first); the work is committed on your branch in logical commits, one per item where practical; nothing is pushed or merged. Report with the test commands and their pass/fail counts, why each defect existed, and anything you dropped and why. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:12:36-03:00

Branch: crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p (4 commits, nothing pushed).

Proof
- `node --test "tests/scripts/crew-*.test.mjs"` → 94 tests, 94 pass, 0 fail.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` → 25 pass, 0 fail.
- The new tests run against the pre-change scripts (HEAD~4): 10 fail, listed per item below; all pass after.

Per item (why it existed → fix)
- 4 report --file: readFileSync ran bare in crew.mjs, so ENOENT escaped as a stack. Now a CrewError: "The report file X could not be read: it does not exist…", exit 1. Test: crew-cli.
- 5 unconfirmed prompt: seat collapsed "never sent" and "sent, not confirmed" into prompted:false, and nudge resends. Now prompted is true | false | 'unconfirmed' (old true/false files work; tested). nudge refuses 'unconfirmed' with a sentence naming the pane and the role/assignment paths to type. seat prints the same honestly and says not to nudge. Also: if a nudge's own prompt fails, it now records 'unconfirmed' (otherwise a second nudge would resend). agent_not_ready at start stays false/nudge as before.
- 6 dash brief: `--` works with parseArgs (verified: `seat engineer --task t -- -5 degrees` → positionals keep the dash words; flags must come before `--`). USAGE and the unknown-option error now say so for seat and handoff. Test: crew-cli. docs/CREW.md updated.
- 7 herdr timeout: execFileSync had no timeout. createHerdr({bin, timeoutMs}) (default 60s, long enough for agent start) throws HerdrError code `herdr_timeout`, plain message. promptAgent timeouts land in the unconfirmed path in seat/nudge; a startAgent timeout is a seating failure (recorded, as any start failure). Testable with a stub binary: new tests/scripts/crew-herdr.test.mjs. By hand against real herdr: nothing; not run.
- 8 sync-conflict copies: readTrail read them as records. Now skipped as records and listed in `unreadable`, so the board's existing "Could not read:" line shows them. Reason: the copy may hold the newer state and the operator must merge it by hand; silent skipping hides that. Never deleted. Wording "Could not read" is slightly off for this; a dedicated line needs renderBoard, which was not mine (see below).
- 9 manifest: module.yaml listed no tests. Globs are not resolved by the engine, so each crew test file plus tests/helpers/crew-fixtures.mjs is listed explicitly (identity mapping). The manifest test now fails if any tests/scripts/crew-*.test.mjs on disk is not listed. clone-manifest.txt gained crew-herdr.test.mjs.
- 10 lead commands: assignmentBody now takes the role; may_seat roles also get board, seat (with --base guidance), nudge, release, handoff-close by absolute script path. Other roles do not. Test in crew-seat.

For others
- Other engineer: a new crew-*.test.mjs on their branch must be added to modules/org-os-crew/module.yaml, or module-manifests.test.mjs fails after merge. Expect a trivial conflict in module.yaml/clone-manifest.txt if they add tests.
- A conflict-copy line on the board needs a renderBoard change (not made).
- skills/crew/SKILL.md untouched; nothing in it became untrue.

Migration note: assignment files may now carry prompted: 'unconfirmed'; older files with true/false behave as before. No instance action needed.

Do differently: I would have represented prompted as one explicit state field from the start instead of a boolean.
