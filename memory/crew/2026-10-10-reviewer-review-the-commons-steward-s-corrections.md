---
id: 2026-10-10-reviewer-review-the-commons-steward-s-corrections
role: reviewer
agent: reviewer-2
kind: claude
branch: crew/2026-10-10-commons-steward-check-that-the-record-around-crew-is-tru
detached: true
pane: 'w13:p1'
workspace: w13
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-the-commons-steward-s-corrections
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:27:52-03:00'
updated: '2026-10-10T23:31:41-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the commons-steward's corrections to the record around crew

Goal. Give a pass or fail verdict on the branch you are seated on, four documentation commits on feat/crew (03d8bb8): `git diff feat/crew...HEAD` touches docs/COMMANDS.md, docs/MODULES.md, CHANGELOG.md and docs/agent-plans/QUEUE.md. On a pass the lead merges it into feat/crew, which is then pushed, so an untrue sentence here reaches every operator who reads the changelog.

Where to look. The steward's report, with each claim it says it checked and how: Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-commons-steward-check-that-the-record-around-crew-is-tru.md (read only). The code is the source of truth: scripts/crew.mjs (USAGE), scripts/crew/*.mjs.

Check. Every command and option the changed documents show, against the usage text (`node /Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs --help` is safe to run; your own worktree's copy needs `npm ci --ignore-scripts` first). Every behavioural sentence in the new CHANGELOG text against the code at 03d8bb8, with file and line. Plain language for a first-time operator: terms defined on first use, the vocabulary of roles/README.md, no claim of a count or capability that is not in the repository. Whether the CHANGELOG entry sits honestly under a preface that says everything below is already on main (the steward flagged this and left the preface alone). `npx prettier --check` on the four files if the repository's formatting check covers them.

One more thing the steward could not know. A second branch, crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo, is about to be merged into feat/crew as well. It changes behaviour the new text describes: sync-conflict copies get their own board line instead of "Could not read", board rows show an unsent or unconfirmed first prompt, only a missing herdr binary leaves the first prompt unsent, a herdr timeout during release leaves the worktree, and every seat is sent to a "Before you begin" reading list. Read `git diff feat/crew...crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo -- scripts docs/CREW.md roles` and list, with file and line, each sentence on the branch under review that will become untrue or incomplete once both are merged. Those are not failures of this branch; they are the work list for the steward's next pass.

Done means. A verdict, pass or fail, with the commands run, expected versus actual for each finding with file and line, whether each must be fixed before merge or can follow, and the separate list of sentences the second branch will make stale. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:31:05-03:00

Verdict: PASS, with one fix I recommend before merge (finding 1, one sentence) and four small ones that can follow.

Branch: detached at 10f654d, four docs commits on feat/crew 03d8bb8. I changed nothing.

## Commands run

- `git diff feat/crew...HEAD --stat` -> 4 files, 44 insertions, 7 deletions (docs/COMMANDS.md, docs/MODULES.md, CHANGELOG.md, docs/agent-plans/QUEUE.md). No code touched.
- `node /Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs --help` -> usage text, exit 0. Same text as USAGE in scripts/crew.mjs:18-33 of this worktree.
- `npm ci --ignore-scripts` -> exit 0.
- Read in full at 03d8bb8: scripts/crew.mjs, scripts/crew/core.mjs, herdr.mjs, trail.mjs, git.mjs (rescueDetached, changes, removeWorktree).
- `npm run crew -- seat r -- "-x brief"` -> reaches the herdr guard ("This is a crew worktree's own copy..."), so `--` is accepted through npm and parseArgs. Without `--` the argument parser rejects the dash word. Checked with `util.parseArgs` too: positionals `["seat","r","-x brief"]`.
- `npx prettier --check CHANGELOG.md docs/COMMANDS.md docs/MODULES.md docs/agent-plans/QUEUE.md` -> warns on CHANGELOG.md and docs/agent-plans/QUEUE.md; COMMANDS.md and MODULES.md pass. Same warning on the same two files at feat/crew 03d8bb8 (checked from a copy of the base files). The changed hunks are clean: CHANGELOG.md lines 21-43 and QUEUE.md line 18 are not in prettier's diff. The warnings are old `*em*` and a QUEUE line 17 item. `npm run check` runs `prettier . --check` (package.json:57), so the repository check was already failing; this branch does not make it worse.
- Not run: seat, nudge, release, report, handoff and handoff-close against a real herdr (no herdr session here). Everything about their behaviour is from reading the code.

## Clean-room and what each check could fail on

- COMMANDS.md:262-272, every command and option, compared line by line to USAGE: board [--json], seat with --task/--base/--on/--handoff, nudge, release --outcome done|abandoned, handoff-close --reason, report [--file], handoff [--branch]. All present, none invented. A check that could fail: the old list had 3 of 7 commands; the new one has 7 of 7.
- COMMANDS.md:278 "every command refuses outside [herdr]": board, seat, nudge, release, report, handoff, handoff-close all call requireHerdr (core.mjs:121,240,268,281,304,334,444). `--help` does not, which is fine.
- COMMANDS.md:286-289 Paperclip: DECISIONS.md:17 (2026-10-10) says the team no longer runs on it; DECISIONS.md:71-83 (2026-08-29) deletes the Paperclip apps and guide in 0.6.0; spec section 11 (line 388) lists the three `paperclip*` npm scripts for 0.6.0. The cited sections say what the sentence says. package.json:62-64 scripts exist.
- MODULES.md:191 "seats, nudges, releases and lists": `nudge` exists. "herdr.mjs is the only file that does": git.mjs shells to git, not herdr. True.
- CHANGELOG bullets, each against 03d8bb8:
  - STATUS beside STATE: core.mjs:490-491, 456. True.
  - "Worktrees left behind" list: core.mjs:324-325, 471, 508-511. True.
  - release branch kept/never created, worktree removed/left: core.mjs:421-439. True.
  - retry never forces: git.removeWorktree has no force flag (git.mjs, "No force flag"); retry refuses a different outcome: core.mjs:357-360. True.
  - 8 seconds: herdr.mjs:20, 108-123. True (gives up at about 7.5 s).
  - "may or may not have arrived": crew.mjs:122. nudge refuses: core.mjs:242-244. True.
  - 60 s `herdr_timeout`: herdr.mjs:17, 41-46. True. Error code kept: core.mjs:223 (`error_code`). True.
  - Syncthing copy under "Could not read": trail.mjs:97-104, core.mjs:512. True at 03d8bb8.
  - Rescue branch never moved, `-2`, `-3`: git.mjs rescueDetached, `for (let n = 2; taken(name); n += 1)`. True.
  - Dash brief: crew.mjs:68-73 and the test above. True.
- Module facts: MODULES.md:198 says `pilot`; DECISIONS refs and spec path exist. QUEUE.md:18 "built and merged on feat/crew at 03d8bb8": `git log` shows 03d8bb8 is the feat/crew tip this branch sits on. True.
- roles/README.md vocabulary: assignment, agent, role, operator are used as defined. Terms used with no definition: "rescue branch", "detached", "first cycle", "Syncthing" (see findings 3 and 4).

## Findings

1. CHANGELOG.md:9-11 vs :24-25 (preface contradicts the entry). Expected: the section's preface and its entries agree. Actual: the preface says "Everything below is already on `main`"; the crew bullet under it says "not yet merged into `main`", and says "Targets 0.6.0" under a heading "Staged for `0.5.1`". `git show main:CHANGELOG.md | grep -c "Crew — role"` is 0. The new sentence is true and the preface is untrue. Fix before merge: make the preface say "except the Crew entry, which is only on `feat/crew`", or move the entry under its own heading. That sentence will be false again the moment feat/crew merges to main, so whoever merges must also take out "not yet merged into main" (CHANGELOG.md:24-25, QUEUE.md:18). Lead decides which; I would not push the entry as it stands.
2. CHANGELOG.md:34-36 "`nudge` refuses in that case" and :41-42, plain-language gaps (can follow). "rescue branch" and "detached" are not defined where used, and the rescue only happens when the detached copy has commits on no branch. A first-time operator cannot tell when it applies. Suggest: "Commits made in a review copy (`--on`) are saved on a branch `crew/<assignment-id>` when you release; an earlier one is never overwritten (`-2`, `-3`)." docs/CREW.md:106-108 already says it more plainly.
3. CHANGELOG.md:39 "Syncthing" is not introduced. docs/CREW.md and roles/README.md do not mention it. One clause ("Syncthing, the file-sync tool, keeps ...") would do. Can follow.
4. CHANGELOG.md:26 "the first cycle's fixes" means nothing to an operator reading a changelog; it is the crew's internal name for its first run. Say "fixes found in the first real use". Can follow.
5. CHANGELOG.md:30-33 and :43, COMMANDS.md:275-276 and the usage text (crew.mjs:30-32) all show the dash rule for `handoff` too (`handoff <role> [--branch <branch>] -- "<brief>"`). The changed documents show it for `seat` only. Small; the same parser handles both. Can follow.
6. CHANGELOG.md:32 "a retry saves commits made since" holds only for an `--on` assignment (core.mjs:375-385). On an ordinary assignment the commits are already on its branch. Read together with :41, a reader may think every release rescues. Fold into finding 2. Can follow.

I found no false claim of a count or capability. No finding rises to "this sentence is untrue today" except 1.

## Sentences the second branch will make stale or incomplete

Read from `git diff feat/crew...crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo -- scripts docs/CREW.md roles` (core.mjs, trail.mjs, CREW.md, roles/README.md, roles/lead.md). Not failures of this branch; the steward's list.

1. CHANGELOG.md:39-40 "A Syncthing `.sync-conflict-` copy ... is listed under 'Could not read'". Untrue after the merge: trail.mjs puts it in `conflicts`, core.mjs renders it under "Sync conflict copies"; "Could not read" is only for files that cannot be parsed. The "merge it by hand" part stays true (and now also "delete it").
2. CHANGELOG.md:27-29 board description. Incomplete: STATUS now reads `working (first prompt not sent)` or `working (first prompt unconfirmed)` for an agent that may not have been told its task; the board also gains a "Sync conflict copies" section.
3. CHANGELOG.md:34-36 first prompt. Incomplete: a missing herdr binary now leaves the prompt not sent (`prompted = false`), and `nudge` then works (it says "nothing was sent"); only other failures are "may or may not have arrived". "`nudge` refuses in that case" is still true for the unconfirmed case.
4. CHANGELOG.md:37-38 "A herdr call that does not answer within 60 seconds fails with `herdr_timeout`". Incomplete: a timeout while seating now says the worktree or agent may exist anyway and points to "Needs release"; a timeout while release asks herdr to remove the worktree now leaves the worktree (no fall-through to git) and says to run release again.
5. CHANGELOG.md:30-33 release. Incomplete: "with the files that held it" is no longer the whole list; on a failed retry rescue the output names the branch an earlier release made and leaves the worktree; a herdr timeout is a reason for leaving it. (core.mjs:399-403, 414-424, 458-465.)
6. CHANGELOG.md:21-43 as a whole has nothing about the new first step every seat takes: it is sent to the "Before you begin" list in roles/README.md (MASTERPLAN.md, SOUL.md, MEMORY.md; `lead` also HEARTBEAT.md and AGENTS.md) and reports which it read. An operator will see agents reading these files and will not know why.
7. COMMANDS.md:267 `nudge` comment "to an agent that stopped at a startup dialog". Incomplete: it also now sends it after herdr was missing. Minor.
8. COMMANDS.md:262-266 board comment "what needs attention" and MODULES.md:191-194 are still true; MODULES.md "Status. `pilot`" (:198) and its description of how the assignment is given are unchanged in meaning.
9. QUEUE.md:18 "built and merged on `feat/crew` at `03d8bb8`". Stale once the second branch and this one are merged: 03d8bb8 is no longer the tip. Say "on `feat/crew`" and drop the commit, or update it.
10. CHANGELOG.md:24-25 and QUEUE.md:18 "not yet on main": becomes false when feat/crew reaches main (see finding 1).

## Not checked

- Anything that needs a live herdr (seat/release behaviour end to end, the docs/CREW.md smoke run). The `pilot` status in MODULES.md ("built and verified") is the steward's and the lead's to confirm.
- The two lines of prettier warnings (CHANGELOG.md, QUEUE.md) are not caused by this branch, so I did not weigh them in the verdict. Running `npm run format` on those files would also reformat many unrelated lines.
