---
id: 2026-10-11-commons-steward-correct-the-two-sentences-that-failed-re
role: commons-steward
agent: commons-steward
kind: claude
branch: crew/2026-10-11-commons-steward-correct-the-two-sentences-that-failed-re
detached: false
pane: 'w1D:p1'
workspace: w1D
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-commons-steward-correct-the-two-sentences-that-failed-re
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: reported
prompted: true
created: '2026-10-11T00:02:14-03:00'
updated: '2026-10-11T00:06:43-03:00'
---
## Brief

Correct the two sentences that failed review in the record, and the small ones beside them

Goal. The commons-steward's last pass (the branch you start from, eight commits on feat/crew 63bab29) failed review narrowly: two places say something the repository does not show. Fix those and the small findings in the same files, on your branch stacked on it, so the pair can be merged and pushed tonight. The reviewer found every behavioural sentence it traced to code to be true; do not rewrite what passed.

The findings, with file, line and evidence, are in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-commons-steward-s-last-pass-t.md (read only). Read it in full first.

Must fix (the review's blockers).
B-1. "A lead and the five shipped roles" is false: roles/ holds five role files, lead included (run `ls roles` and count). The wrong count is the lead's, who wrote it into the brief; correct it wherever the cap is explained (roles/circles.yaml comment, CHANGELOG.md, docs/CREW.md, the spec's guardrail table). The cap stays 6, the operator's decision. The true reason: the five shipped roles take five seats and the sixth allows a second agent in one role, for example a reviewer while an engineer is still seated.
B-2. The spec's board example (section 8) is not output renderBoard can produce: values are cut at the wrong lengths and the path is abbreviated. Replace it with real output: call renderBoard from scripts/crew/core.mjs with literal board data (the reviewer shows how and gives the rows it got) and paste what it prints, with a made-up home directory in the path, never this machine's.

Fix in the same pass.
S-1. skills/crew/SKILL.md "Releasing" says git-ignored files all keep the worktree; installed dependencies do not (scripts/crew/git.mjs, and docs/CREW.md says it correctly).
S-2. Spec section 7 still says a handoff's branch seats that branch with no mention of --base, contradicting its own section 5.
F-B, wording only: HEARTBEAT.md and MEMORY.md say "trail files"; say "files in memory/crew/" as docs/CREW.md now does. And say plainly, once, that those files are in the main checkout and are committed by the operator at session close, so on another checkout they may not exist yet.
F-C. HEARTBEAT.md's list of open findings misses one sub-item of F-4 (the ambiguity message "still has a worktree").
F-D. One sentence where the cap is explained, for an operator on a small plan: each seated agent is a full model session on the operator's own plan, and the cap is lowered by editing max_agents.
F-E. One sentence in the CHANGELOG's crew section for an existing instance: what a sync brings and what it does not, and what to copy or add (roles/, docs/CREW.md, skills/crew/, the `crew` script in package.json). The reviewer read this from packages/instance-doctor/src/overlay.mjs and scripts/sync-upstream.mjs without running a sync; check those sources yourself and write only what they show.
F-F. The four wording points: the two timeout cases merged into one sentence; "ends in" should be "reads"; the "not on main" notices in four files, to be listed in the CHANGELOG heading's note so whoever merges to main removes all four; and the advice on reading DECISIONS.md, which the reviewer would make checkable ("the newest three entries, and search the file for words in your brief").
Also F-A's second half only where it is a document: roles/README.md says changing the list needs no code change, while a test hardcodes the four names. Do not touch the test; say in your report what an engineer should change (the reviewer gives the fix).

Not yours. `scripts/crew.mjs` help text for nudge, renderBoard's wording and tests/scripts/crew-shipped-roles.test.mjs are code: list them in your report for the engineer. MASTERPLAN.md stays untouched.

Branches in flight. None that touch your files. A researcher's note docs/research/2026-10-10-herdr-one-crew-workspace.md is on its own branch. After your branch merges, an engineer will add labels to herdr's agent list; nothing about that is written yet, so write nothing about it.

Done means. Logical commits on your branch; nothing pushed or merged. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"`, `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` and `npm run version:check` pass; prettier no worse than on your base for the files you touch. Report what you changed per finding with the command or listing that shows each corrected sentence is now true, the onboarding files you read, and the list for the engineer. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T00:06:43-03:00

## Done: the two blockers and the findings beside them are corrected, in two commits on top of de0f0aa

Branch: crew/2026-10-11-commons-steward-correct-the-two-sentences-that-failed-re (7fe4c80, 6b7f330). Nothing pushed or merged. 7 files, +67/-36. MASTERPLAN.md, code and tests untouched.

### Onboarding files read
MASTERPLAN.md (166 lines), SOUL.md (64), MEMORY.md (81) in full; DECISIONS.md lines 1-60 of the file (conventions, the 2026-10-10 crew entry, two 2026-08-29 entries). Also the reviewer's report in full. Absent: nothing. Note: the "Before you begin" I was sent to from the main checkout's roles/README.md was the section in my worktree's branch, which lists the four files.

### Per finding

**B-1 (the cap's reason).** `ls roles` lists README.md, circles.yaml and five role files; `grep -c '^id:' roles/*.md` gives commons-steward, engineer, lead, researcher, reviewer, one each. Now every place says: the five shipped roles (the lead among them) take five seats, the sixth allows a second agent in one role, for example a reviewer while an engineer is still seated. Cap stays 6. Changed: roles/circles.yaml comment, CHANGELOG.md (crew section, first sub-bullet), docs/CREW.md ("Let a lead coordinate"), spec section 5.1 guardrail table. Shown by: `grep -rn "lead and the five\|and the five shipped" roles CHANGELOG.md docs/CREW.md docs/COMMANDS.md skills/crew docs/superpowers/specs HEARTBEAT.md MEMORY.md` returns nothing. I did not touch docs/superpowers/plans/ (a record, as the reviewer noted).

**B-2 (board example).** Spec section 8 now holds output of `renderBoard` (scripts/crew/core.mjs) called with literal board data, run by me this session; values are cut at 32 and 44 characters with `…`, and the worktree path is full with a made-up home (`/Users/alex/...`). A line above it says so. The data and the output are the same rows the reviewer gave. The "a trail file" wording inside the Syncthing line is the code's own, kept because it is real output (listed for the engineer).

**S-1.** skills/crew/SKILL.md "Releasing": git-ignored files keep the worktree, installed dependencies (`node_modules/`) do not. Matches scripts/crew/git.mjs:50-61 (`changes()` drops `!! node_modules/`) and docs/CREW.md.

**S-2.** Spec section 7: a handoff's branch seats a detached copy only when neither `--on` nor `--base` is given; with `--base <ref>` a new branch from `<ref>` and the handoff is still taken (section 5, step 4, and core.mjs:187).

**F-B.** HEARTBEAT.md: "Trail files" and "Trail:" are now "files in `memory/crew/`" (three places). One plain sentence says those files are in the main checkout, are committed by the operator at session close, and may not exist yet on another checkout. MEMORY.md did not contain the word "trail" (`grep -n "trail\|Trail" MEMORY.md` is empty), so I left it unchanged; it says "a file under `memory/crew/`" already and sends the reader to HEARTBEAT.md for the open items.

**F-C.** HEARTBEAT.md F-2 to F-4 item now also lists the ambiguity message "More than one closed assignment … still has a worktree", which covers records whose worktree is already gone: `unfinishedRemoval` (core.mjs:427) filters on status and `worktree_removed === false`, not on whether the directory exists; the message is at core.mjs:458.

**F-D.** One sentence in each place the cap is explained (circles.yaml, CHANGELOG, CREW.md, spec table): each seated agent is a full model session on the operator's own plan; lower the number by editing `max_agents` in roles/circles.yaml.

**F-E.** CHANGELOG crew section, new bullet for an existing instance. Checked in source myself, no sync run: `FRAMEWORK_OWNED = ['scripts/', 'templates/']` (packages/instance-doctor/src/overlay.mjs:35) so `doctor sync` brings scripts/crew.mjs and scripts/crew/ and not roles/, docs/CREW.md or skills/crew/; `package.json` is in INSTANCE_OWNED; `sync:upstream` stage 5 is `git pull --rebase upstream main` (scripts/sync-upstream.mjs:151-154), which carries every file from main with conflicts left to the instance; without roles/ the launcher stops with "This repository has no crew roles" (scripts/crew/roles.mjs:28). The bullet says to copy roles/, docs/CREW.md, skills/crew/ and add `"crew": "node scripts/crew.mjs"` to package.json `scripts`.

**F-F.**
- Timeouts: the two cases are now stated together in one sentence in CHANGELOG, docs/CREW.md and the spec: the message says which was asked; after the removal request herdr may still be removing it, after the question nothing was removed (core.mjs:510-516).
- "ends in" → "reads": CHANGELOG now says a `STATUS` that reads `working (first prompt not sent)` or `working (first prompt unconfirmed)`.
- "Not on main": CHANGELOG heading note now lists MEMORY.md (Active Context), HEARTBEAT.md (Crew) and the spec's Status line, to be removed in the same merge.
- DECISIONS.md advice, roles/README.md: "read its newest three entries, then search the file for words in your brief and read each entry that matches".

**F-A, document half.** roles/README.md no longer says "no code needs to change": the launcher only names the section in the first prompt (core.mjs:83, :91, :148) and does not read the list, and one test does read it. The sentence says so and names the test.

### Verification (run in this worktree)
- `npm ci --ignore-scripts`: completed.
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 151, pass 151, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0.
- `npm run version:check`: "All version sources agree".
- Prettier, lines that differ from formatted output, de0f0aa vs now: CHANGELOG 21 -> 21, HEARTBEAT 20 -> 20, MEMORY 6 -> 6 (unchanged), CREW 2 -> 2, SKILL 18 -> 18, spec 105 -> 105, roles/README.md 0 -> 0, circles.yaml 0 -> 0. Not worse.
- Added lines contain no machine path except the invented `/Users/alex/...` in the board example.
- Both commits passed the pre-commit `validate:structure` hook (53 passed, 0 failed).

### For the engineer (not mine; not changed)
1. `scripts/crew.mjs` help text for `nudge`: says "an agent that stopped at a startup dialog"; PROMPT_NOT_SENT (core.mjs:30-37) allows six causes, which docs/COMMANDS.md now names.
2. `renderBoard` wording (core.mjs, Syncthing line): "Syncthing kept these … a trail file" defines neither term; "trail" is not in the roles/README.md vocabulary. If changed, the spec's section 8 example must be regenerated from the new output (the data I used is in this report's description; any literal board will do).
3. `tests/scripts/crew-shipped-roles.test.mjs:52-58`: the section regex collects every backticked `*.md` in the whole "Before you begin" section, so prose mentioning `DECISIONS.md` satisfies it after the bullet is deleted (the reviewer reproduced this: pass 8, fail 0). Fix: read only bullet lines (`^- \``). Also, line 58 hardcodes the four names, so an instance that edits its list fails its own test; either read the required names from a place the instance edits, or make the test skip names an instance's list removed. roles/README.md now says this plainly.
4. F-1 to F-4 of the herdr review stay open as HEARTBEAT.md lists them.

### What went wrong, and what I would do differently
I first ran my verification with a grep using `--include` after a path list, which zsh refused to expand, and I read the first run of prettier numbers before I had changed roles/README.md; I re-ran both. The first draft of the README sentence said the launcher "reads nothing from" the section, which `grep -rn "Before you begin" scripts/` showed to be too strong (core.mjs puts the section name in the prompt); I corrected it before committing. I checked the F-E sources by reading, as the reviewer did; no sync was run, so a real `doctor sync` on a scratch instance would be the stronger evidence.

### Handoff
To reviewer, with `--branch crew/2026-10-11-commons-steward-correct-the-two-sentences-that-failed-re`.
