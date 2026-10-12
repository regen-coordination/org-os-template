---
id: 2026-10-10-reviewer-review-the-commons-steward-s-last-pass-t
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t
detached: true
pane: 'w1C:p1'
workspace: w1C
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-the-commons-steward-s-last-pass-t
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:54:56-03:00'
updated: '2026-10-11T00:02:13-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the commons-steward's last pass: the record, the onboarding files and the cap

Goal. Give a pass or fail verdict on the branch you are seated on: eight commits on feat/crew (63bab29), `git diff feat/crew...HEAD`. On a pass the lead merges it and pushes feat/crew, and from then on these documents are what every operator reads and what every newly seated agent is sent to before it starts. Documents only, except two things: `max_agents` in roles/circles.yaml goes from 4 to 6 (the operator's decision), and one line of tests/scripts/crew-shipped-roles.test.mjs.

The claims are in the steward's Report section, item by item, with the code lines it says it checked: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t.md (read only). Its brief is the Brief section of the same file.

Check.
1. Every behavioural sentence added or changed in CHANGELOG.md, docs/COMMANDS.md, docs/CREW.md, skills/crew/SKILL.md and the spec (docs/superpowers/specs/2026-10-10-org-os-crew-design.md) against the code on this branch, with file and line: the 30 second ceiling, the six "prompt not sent" codes, the cut-off start, leftovers after a failed worktree step, release after a herdr timeout, `seat --handoff --base`, the board's sections and STATUS markers. The spec's board example must be output renderBoard can really produce: build one with the fake adapters or by reading, and say which.
2. Every command shown, against `node scripts/crew.mjs --help` (run `npm ci --ignore-scripts` first).
3. CHANGELOG structure. The crew entry now sits in its own section above `## [Unreleased]`. Read scripts/update-version.mjs and whatever `npm run version:check` runs, and say whether that placement is safe for the next release and whether any tool or test reads the changelog's first heading. Run `npm run version:check`.
4. The onboarding files. MEMORY.md and HEARTBEAT.md now describe the crew; roles/README.md adds DECISIONS.md to "Before you begin". These are read by every seat before it works, so a wrong sentence here misleads every agent. Is each sentence true and checkable? Is the HEARTBEAT.md list of open items complete against the last review's findings F-1 to F-4 (Report section of .../memory/crew/2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before.md)? Does the advice on reading a 478-line DECISIONS.md cost a seat more than it gives? You were sent to this list yourself, in the older form without DECISIONS.md: say what you read.
5. The cap. roles/circles.yaml says 6 and every document that states a number agrees; the fallback DEFAULT_MAX_AGENTS = 4 in scripts/crew/roles.mjs is not confused with it anywhere. A new instance receives this file: say what a first-time operator on a small plan meets.
6. Downstream first. roles/, docs/ and the skill reach instances by sync. Is there a migration note where an instance would need one?
7. Plain language and the vocabulary of roles/README.md; nothing claimed that the repository does not show; anything that should not be pushed (secrets, personal data, this machine's paths).

Done means. A verdict, pass or fail, with the commands run and counts (`node --test "tests/scripts/crew-*.test.mjs"`; `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`; `npm run version:check`; `npx prettier --check` on the changed files compared with 63bab29), expected versus actual for each finding with file and line, and whether each must be fixed before merge or can follow. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T00:01:18-03:00

## Verdict: FAIL, narrowly. Two small corrections block the merge; everything else can follow.

Branch under review: detached HEAD de0f0aa, eight commits over feat/crew 63bab29 (`git diff feat/crew...HEAD`, 12 files, +168/-68). I changed nothing.

The behavioural sentences are sound: every one I traced to code holds. The two blockers are documents that say something the repository does not show, in the exact places the brief asked me to hold to a standard (the board example, the cap). Each is a few lines. A re-review of those lines is enough.

### What I read (Before you begin)
Role file and assignment. `roles/README.md` of the main checkout, which is where the first prompt sends a seat: it is still the older three-file form (MASTERPLAN.md, SOUL.md, MEMORY.md), because this branch is not merged there. So a seat reviewing this branch is not sent to DECISIONS.md; the new list takes effect only once it is in the main checkout. From my own worktree I read MASTERPLAN.md (166 lines), SOUL.md (64), MEMORY.md (81) in full, and DECISIONS.md lines 1-80 of 478 (conventions, the 2026-10-10 crew entry and three 2026-08-29 entries). Also the branch's own roles/README.md "Before you begin" (four files). Absent: nothing.

### Commands run and counts
- `npm ci --ignore-scripts`: completed.
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 151, pass 151, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0.
- `npm run version:check`: "All version sources agree" (package.json 0.5.0, federation.yaml 0.5, CHANGELOG 0.5.0, VERSION.md 0.5.0, MASTERPLAN.md 0.5.0).
- `node scripts/crew.mjs --help`: compared with every command line the changed documents show (below).
- Prettier, changed-line count of `prettier --stdin-filepath` output vs file, 63bab29 -> HEAD: CHANGELOG 21 -> 21, HEARTBEAT 20 -> 20, MEMORY 6 -> 6, CREW 2 -> 2, QUEUE 36 -> 36, plan 2133 -> 2133, spec 109 -> 105, SKILL 18 -> 18, test 90 -> 90; COMMANDS, roles/README.md, circles.yaml 0 -> 0. No file is worse. `--check` warns on the same 9 files as before.
- Secrets and machine paths: grep of the added lines for `/Users/`, `.cache`, `.org-os/`, the operator's name, token, secret, key, email: no hits.

### Blockers (fix before merge)

**B-1. "A lead and the five shipped roles" is false: there are five roles in total, lead included. The cap's stated reason is wrong.**
- Files: roles/circles.yaml:2-4; CHANGELOG.md (Crew section, first sub-bullet); docs/CREW.md:121; docs/superpowers/specs/2026-10-10-org-os-crew-design.md:219.
- Expected: a count the repository shows. Actual: `ls roles` gives commons-steward, engineer, lead, researcher, reviewer (`grep -n '^id:' roles/*.md`, five lines). A lead and four others is five. The whole crew fits under a cap of 5; 6 leaves room for one duplicate seat. (The `strategy` circle has no role file.) The operator chose 6 and I do not reopen the number; the reason given for it is what is wrong, and every sentence that states the number states it with that reason.
- Fix: say "six at once; the five shipped roles take five of them", or drop the reason.

**B-2. The spec's board example (section 8) is not output `renderBoard` can produce.** The brief made this a pass criterion.
- File: docs/superpowers/specs/2026-10-10-org-os-crew-design.md:424-445.
- Method: I called `renderBoard` from scripts/crew/core.mjs with literal board data shaped like the example (read the code at core.mjs:628-662, then ran it; the fake adapters were not needed since `renderBoard` takes the board object).
- Expected vs actual: the format, column order, header, STATUS, the four sections, the Syncthing line and "Could not read" all match. Three things do not: (1) `clip(text, 32)` and `clip(text, 44)` (core.mjs:620, 635) cut at exactly 32 and 44 characters; the example cuts the assignment at 23 characters ("Fix the cursor race in…") and the branch at 35 ("crew/2026-10-10-engineer-fix-the-c…"), which no input yields; (2) the worktree path is printed in full, never as `/…/worktrees/…` (core.mjs:654);
- What the code produces for the same rows (briefs "Review the cursor fix, and say whether the race is closed" and "Fix the cursor race in the kms ingest"; branch `crew/2026-10-10-engineer-fix-the-cursor-race-in-the-kms-ingest`):
```
AGENT     ROLE      STATE    STATUS    ASSIGNMENT                        BRANCH                                        AGE
reviewer  reviewer  blocked  working   Review the cursor fix, and say …  crew/2026-10-10-engineer-fix-the-cursor-rac…  3m
engineer  engineer  idle     reported  Fix the cursor race in the kms …  crew/2026-10-10-engineer-fix-the-cursor-rac…  18m
```
and `Worktrees left behind: 1` / `  2026-10-09-engineer-ingest-retry (released; its worktree is still at /Users/x/.org-os/worktrees/org-os/2026-10-09-engineer-ingest-retry)`. Either paste that, or add one line that long values are shortened and the example shortens them by hand.

### Should fix with the blockers (small, same pass)

**S-1. skills/crew/SKILL.md "Releasing" says git-ignored files all keep the worktree. They do not: installed dependencies do not.**
- File: skills/crew/SKILL.md (Releasing, "modified, untracked and git-ignored files all keep it"). Code: scripts/crew/git.mjs:56-60 drops `!! node_modules/` from `changes()`. docs/CREW.md (Release) says it correctly ("installed dependencies do not").
- Why it matters: the lead acts on the skill. A reviewer runs `npm ci` (roles/reviewer.md), so every review worktree has a node_modules; read literally, the skill says none of them can be removed.

**S-2. Spec section 7 still says a handoff's branch seats that branch, with no mention of `--base`.**
- File: docs/superpowers/specs/2026-10-10-org-os-crew-design.md:414-415. Code: scripts/crew/core.mjs:187 (`!on && taken.branch && base === null`). The spec's own section 5 (lines 193-197) says an explicit `--base` wins, so the document contradicts itself. This is the one sentence of the five-problem list item 4 that survives in a changed form.

### Findings that can follow

**F-A. The shipped test cannot fail for DECISIONS.md.** tests/scripts/crew-shipped-roles.test.mjs:52-58 collects every backticked `*.md` in the whole section, and the new prose "`DECISIONS.md` is long and newest first" is in the section. Repro (scratch copy of HEAD, not the branch): delete the `- \`DECISIONS.md\`` bullet from roles/README.md, run `node --test tests/scripts/crew-shipped-roles.test.mjs`: pass 8, fail 0. Expected: "the shared list lost DECISIONS.md". The same prose also satisfies MEMORY.md. Fix: read only the bullet lines (`^- \``). Also by reading: roles/README.md says changing the list needs no code change, but the test hardcodes the four names, so an instance that removes SOUL.md from its list fails its own test.

**F-B. HEARTBEAT.md points at files that are not in the repository.** `git ls-files memory/crew` is empty; in the main checkout `git status` shows `?? memory/crew/`. HEARTBEAT.md ("Trail files are in memory/crew/ of the main checkout"), MEMORY.md and the F-1 bullet send the next session to those trail files. They exist on this machine only until someone commits `memory/crew/` (CREW.md says to). Until then, on any other checkout the pointers dangle, and F-2 to F-4 survive only as the one-line summary. Operator: commit `memory/crew/` with the merge, or accept that. Also HEARTBEAT says "Trail files" and "Trail:", words the steward removed from CREW.md as unclear and that roles/README.md's vocabulary does not define; say "files in memory/crew/".

**F-C. HEARTBEAT.md's F-1..F-4 list is complete except one sub-item.** Checked against the last review: F-1 yes; F-2 yes; F-3 yes (silent wait, bound); F-4: gone-worktree record not on board yes, failed record omits `may_remain` yes, `--base ""` yes, but the ambiguity message "still has a worktree" (core.mjs:458) now also covering records whose worktree is gone is missing. F-1's description matches the code as it stands (core.mjs:531, :551, :565): still unfixed, and correctly labelled so.

**F-D. The cap, for a first-time operator on a small plan.** A new instance receives `max_agents: 6` (clone carries roles/, per scripts/lib/clone-excludes.mjs:57; its MEMORY.md and HEARTBEAT.md are reset scaffolds, so they never see the crew entries). The cap is also the lead's spending allowance: roles/lead.md says "never more than the cap allows". Raising 4 -> 6 lets a lead seat five agents, each a full model session on the operator's own plan, with no sentence in CHANGELOG, CREW.md or circles.yaml telling a small plan to lower it ("usage" appears only in the smoke run). The fallback of 4 is not confused with the shipped 6 anywhere: roles.mjs:23 and :32 unchanged, and each document that gives a number says which is which (checked: CHANGELOG, CREW.md, spec table, circles.yaml comment, plan line 23; the plan's code snippet at line 2851 still says four and the steward judged it a record).

**F-E. Downstream first: there is no note for an existing instance, and one is needed.** Read, not run (no sync, clone or doctor executed). `packages/instance-doctor/src/overlay.mjs:35` `FRAMEWORK_OWNED = ['scripts/', 'templates/']`: a doctor sync brings `scripts/crew.mjs` and `scripts/crew/` and not `roles/`, `docs/CREW.md` or `skills/crew/`. `package.json` is instance-owned, so no `crew` script arrives. Run directly, an instance without roles/ gets "This repository has no crew roles: <dir>/roles/circles.yaml does not exist." (roles.mjs, run on a scratch path). `CHANGELOG.md`, `MEMORY.md`, `HEARTBEAT.md`, `DECISIONS.md` are in INSTANCE_OWNED and are never overlaid. `sync:upstream` is a `git pull --rebase` (sync-upstream.mjs header), which carries every file from main, and conflicts on those instance-owned files are then the instance's. None of this is on main yet, so nothing breaks today; but the CHANGELOG entry says only what a new instance gets. One sentence for existing instances (what a sync brings, what to copy, add `"crew": "node scripts/crew.mjs"` to package.json) belongs in that section before it is folded into a release.

**F-F. Smaller wording.**
- CHANGELOG and docs/CREW.md: after a timeout "herdr may still be removing it" is true when release asked herdr to remove; when it only asked which worktree the workspace is open on, release says "so nothing was removed" (core.mjs:511-516), and herdr cannot be removing anything. The documents merge the two.
- `node scripts/crew.mjs --help` (scripts/crew.mjs) still describes `nudge` as for "an agent that stopped at a startup dialog", while docs/COMMANDS.md now also names herdr missing; the code (PROMPT_NOT_SENT, core.mjs:30-37) allows six causes. Code text, engineer's.
- "A `STATUS` that ends in 'first prompt not sent'": the cell is `working (first prompt not sent)`, so it ends in the closing bracket. Say "reads".
- The words "not on `main`" are now in four places (CHANGELOG heading, MEMORY.md Active Context, HEARTBEAT.md Crew, spec Status). The CHANGELOG tells whoever merges to main to delete its own heading and nothing else; list the other three there.

### Check by check (items 1 to 7 of the brief)

1. **Behavioural sentences against code.** Each holds, file:line in scripts/crew/:
   - 30 s ceiling: herdr.mjs:24, check at :238 (`waited + startRetryMs > startWaitMs`); stops at once on an agent (:226-228) or an unreadable pane (:223-225); one extra try when the shell is already in the foreground (:229-236). Look limit 10 s (:28, :167), call limit 60 s (:18).
   - The six "prompt not sent" codes: core.mjs:30-37, used at :280 and :346. CHANGELOG's parenthesis lists all six; CREW.md names `agent_blocked` as "approval or question dialog", the spec's item 11 lists five plus the missing binary.
   - Cut-off start never sent twice: herdr.mjs:56 (`CUT_OFF_CODES`), :203-217; a second start only on a refusal that proves the first was not accepted. `agent_name_taken` takes the first as started only when the named agent is on that pane (:198-202).
   - Leftovers after a failed worktree step: core.mjs:286, :313-320; recorded as `may_remain`, printed at :303-306 and (release) :561-567; `step === 'worktree'` only.
   - Release after a herdr timeout: core.mjs:496-516, :533, :570; "already removed" needs a closed record with `worktree_removed: false` and no directory.
   - `seat --handoff --base`: core.mjs:187, :189, :234, :135; `--base` with `--on` refused (core.mjs:171; tests/scripts/crew-flow.test.mjs).
   - Board sections and STATUS markers: core.mjs:623-626, :642-661. Section names match CHANGELOG, CREW.md, SKILL, spec.
   - Rescue branch naming: git.mjs:67-82 (never moves an earlier branch; `-2`, `-3`).
   - Spec 5.3 numbered 1 to 12 in order (lines 259-317); item 5 moved above 6 correctly; `nudge` in section 9; `<id|file>` in sections 5, 7, handoff-close. All verified in the file.
2. **Commands against `--help`.** Every usage line in COMMANDS.md, CREW.md, SKILL.md, the spec and CHANGELOG matches the help text, including `seat <role> [--task <id>] -- "<brief>"`, `handoff <role> [--branch <branch>] -- "<brief>"`, `--handoff <id|file>`, `handoff-close <id|file> --reason`, `release <agent|assignment> [--outcome done|abandoned]`. Only difference: nudge's help sentence, F-F.
3. **CHANGELOG placement: safe.** scripts/update-version.mjs:185-193 replaces the first `## [Unreleased]\n` with a stub plus the new `## [X.Y.Z]` heading, so everything below that line is promoted into the release; a section above it is not. Heading regexes `^##\s*\[(\d+\.\d+\.\d+)\]` (update-version.mjs:69, instance-doctor checks/versions.mjs:52, validate-structure.mjs:298) do not match "## Crew — …". Nothing I found reads the first heading: grep over scripts/, tests/, packages/*/src for CHANGELOG lists these and tests/scripts/version-check-surfaces.test.mjs, none of which read the top. One cost: after 0.5.1 is cut the Crew heading stays above the fresh `[Unreleased]` until someone deletes it, as the section says. `npm run version:check` passes.
4. **Onboarding files.** Each sentence in MEMORY.md and HEARTBEAT.md that I could check is true: DECISIONS.md is newest first throughout (dates descend, 478 lines); MEMORY.md "v2.0.0" is gone and the file it pointed at says 0.5.0; roles/README.md's reason ("what is active now", "decision record that MEMORY.md names as authoritative") matches MEMORY.md line 13. The remaining problems are F-B, F-C. On the cost of reading DECISIONS.md: the advice (top entries and the entries your brief touches) is worth it only if "top entries" means a number; I read 80 of 478 lines and one entry of four applied to my task. A seat that follows it literally reads about a fifth of the file. I would say "the newest three entries, and search the file for words in your brief", which costs about the same and is checkable.
5. **The cap.** Covered in B-1 and F-D. Every document that states a number says 6 and keeps 4 as the fallback (circles.yaml:2-4, CHANGELOG, CREW.md:119-123, spec:219; QUEUE and SKILL state none).
6. **Downstream.** F-E.
7. **Plain language, vocabulary, push safety.** "review copy" is defined inline where used (CREW.md `--on`, SKILL); Syncthing is defined; "detached" is explained. "Review copy" is not in the roles/README.md vocabulary table; fine, but a term used in three files. "Trail" is the open item (F-B). Nothing in the diff claims behaviour the code lacks beyond B-1, S-1, S-2. No secrets or machine paths in the added lines.

### What I could not run, and why
Anything needing a live herdr (seat, nudge, release, a real `agent_pane_busy`), and a real sync, clone or `doctor sync`; so F-E is read from source. The five live-herdr experiments stay unverified, as the documents say. I did not run `scripts/crew.mjs seat` end to end.

### What went wrong in my own review
I started from the steward's report claims and the diff, and found B-1 only when I listed `roles/` to check "five shipped roles"; both blockers came from running or listing something the steward's checks had only read. The test weakness (F-A) came from deleting a line in a scratch copy rather than trusting the green test, which is the lens that applies here: a passing check must be able to fail.
